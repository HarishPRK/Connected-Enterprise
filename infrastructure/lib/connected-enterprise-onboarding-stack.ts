import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Aws,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as iot from 'aws-cdk-lib/aws-iot';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as lambdaDestinations from 'aws-cdk-lib/aws-lambda-destinations';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export interface ConnectedEnterpriseOnboardingStackProps extends StackProps {
  readonly stage: 'dev';
}

export function requireUrlList(value: unknown, name: string, fallback: readonly string[]): string[] {
  let values: unknown = value === undefined ? [...fallback] : value;
  if (typeof values === 'string') {
    try {
      values = JSON.parse(values) as unknown;
    } catch {
      throw new Error(`${name} must be a JSON array of URL strings when supplied on the CLI`);
    }
  }
  if (!Array.isArray(values) || values.length === 0 || !values.every((entry) => typeof entry === 'string')) {
    throw new Error(`${name} must be a non-empty array of URL strings`);
  }
  return values.map((entry) => {
    const parsed = new URL(entry);
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !localHttp) {
      throw new Error(`${name} entries must use HTTPS (HTTP is allowed only for localhost)`);
    }
    if (parsed.username || parsed.password || parsed.hash) throw new Error(`${name} entries cannot contain credentials or fragments`);
    return parsed.toString();
  });
}

export class ConnectedEnterpriseOnboardingStack extends Stack {
  constructor(scope: Construct, id: string, props: ConnectedEnterpriseOnboardingStackProps) {
    super(scope, id, props);

    if (props.stage !== 'dev') throw new Error('This stack implementation is intentionally limited to dev');
    if (Stack.of(this).region !== 'us-east-1') throw new Error('ConnectedEnterpriseOnboarding-dev must be synthesized for us-east-1');

    const stage = props.stage;
    const callbackUrls = requireUrlList(
      this.node.tryGetContext('oauthCallbackUrls'),
      'oauthCallbackUrls',
      ['http://localhost:5174/onboarding'],
    );
    const logoutUrls = requireUrlList(
      this.node.tryGetContext('oauthLogoutUrls'),
      'oauthLogoutUrls',
      ['http://localhost:5174/onboarding'],
    );
    const allowedOrigins = requireUrlList(
      this.node.tryGetContext('allowedOrigins'),
      'allowedOrigins',
      ['http://localhost:5174'],
    ).map((entry) => new URL(entry).origin);

    const dataKey = new kms.Key(this, 'DataKey', {
      alias: `alias/connected-enterprise/onboarding/${stage}/data`,
      description: `Connected Enterprise onboarding ${stage} data encryption`,
      enableKeyRotation: true,
      pendingWindow: Duration.days(30),
      removalPolicy: RemovalPolicy.RETAIN,
    });
    dataKey.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'AllowCloudWatchLogsForOnboardingLogGroups',
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('logs.us-east-1.amazonaws.com')],
      actions: [
        'kms:Encrypt',
        'kms:Decrypt',
        'kms:ReEncrypt*',
        'kms:GenerateDataKey*',
        'kms:DescribeKey',
      ],
      resources: ['*'],
      conditions: {
        ArnLike: {
          'kms:EncryptionContext:aws:logs:arn': [
            `arn:${Aws.PARTITION}:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:/aws/lambda/connected-enterprise-onboarding-${stage}-*`,
            `arn:${Aws.PARTITION}:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:/aws/apigateway/connected-enterprise-onboarding-${stage}`,
          ],
        },
      },
    }));

    const signingKey = new kms.Key(this, 'ProfileSigningKey', {
      alias: `alias/connected-enterprise/onboarding/${stage}/profile-signing`,
      description: `Connected Enterprise immutable profile signing key (${stage})`,
      keySpec: kms.KeySpec.ECC_NIST_P256,
      keyUsage: kms.KeyUsage.SIGN_VERIFY,
      pendingWindow: Duration.days(30),
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const table = new dynamodb.Table(this, 'ControlPlaneTable', {
      tableName: `connected-enterprise-onboarding-${stage}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: dataKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: 'expiresAtEpoch',
      removalPolicy: RemovalPolicy.RETAIN,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: { name: 'GSI3PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI3SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const artifactBucket = new s3.Bucket(this, 'ArtifactBucket', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: dataKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
      publicReadAccess: false,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      lifecycleRules: [{
        id: 'Retain-and-archive-immutable-versions',
        enabled: true,
        noncurrentVersionTransitions: [{ storageClass: s3.StorageClass.GLACIER, transitionAfter: Duration.days(90) }],
        noncurrentVersionExpiration: Duration.days(2555),
        abortIncompleteMultipartUploadAfter: Duration.days(7),
      }],
    });
    artifactBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'DenyOldPresignedRequests',
      effect: iam.Effect.DENY,
      principals: [new iam.AnyPrincipal()],
      actions: ['s3:GetObject'],
      resources: [artifactBucket.arnForObjects('*')],
      conditions: { NumericGreaterThan: { 's3:signatureAge': '600000' } },
    }));

    const hardwareProofPepper = new secretsmanager.Secret(this, 'HardwareProofPepper', {
      secretName: `connected-enterprise/onboarding/${stage}/hardware-proof-pepper`,
      description: 'Reserved for a future hardware-proof migration; not used by the preloaded-bootstrap runtime',
      encryptionKey: dataKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ purpose: 'manufacturing-hardware-proof-v1' }),
        generateStringKey: 'pepper',
        passwordLength: 64,
        excludePunctuation: true,
      },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const functionDefaults = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      tracing: lambda.Tracing.ACTIVE,
      memorySize: 512,
      bundling: {
        format: lambdaNodejs.OutputFormat.ESM,
        target: 'node22',
        minify: true,
        sourceMap: true,
        sourcesContent: false,
      },
    } satisfies Partial<lambdaNodejs.NodejsFunctionProps>;
    const dataKeyResource = dataKey.node.defaultChild as kms.CfnKey;
    const dependOnDataKeyPolicy = (group: logs.LogGroup) => {
      // The CloudWatch Logs grant is inline in AWS::KMS::Key.KeyPolicy. An
      // explicit dependency makes the policy effective before Logs attempts
      // AssociateKmsKey/CreateLogGroup, including during failed-stack retries.
      (group.node.defaultChild as logs.CfnLogGroup).addResourceDependency(dataKeyResource);
      return group;
    };
    const logGroup = (name: string, retention = logs.RetentionDays.ONE_MONTH) => dependOnDataKeyPolicy(
      new logs.LogGroup(this, `${name}LogGroup`, {
        logGroupName: `/aws/lambda/connected-enterprise-onboarding-${stage}-${name.toLowerCase()}`,
        retention,
        encryptionKey: dataKey,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    );
    const entry = (filename: string) => path.join(moduleDirectory, '..', 'lambda', filename);

    const preTokenFunction = new lambdaNodejs.NodejsFunction(this, 'PreTokenGenerationFunction', {
      ...functionDefaults,
      functionName: `connected-enterprise-onboarding-${stage}-pre-token`,
      entry: entry('pre-token-generation.ts'),
      handler: 'handler',
      timeout: Duration.seconds(3),
      reservedConcurrentExecutions: 10,
      logGroup: logGroup('pre-token'),
      environment: { TABLE_NAME: table.tableName, STAGE: stage },
    });
    table.grantReadData(preTokenFunction);

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `connected-enterprise-onboarding-${stage}`,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      passwordPolicy: {
        minLength: 14,
        requireDigits: true,
        requireLowercase: true,
        requireSymbols: true,
        requireUppercase: true,
        tempPasswordValidity: Duration.days(3),
      },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    userPool.addTrigger(
      cognito.UserPoolOperation.PRE_TOKEN_GENERATION_CONFIG,
      preTokenFunction,
      cognito.LambdaVersion.V2_0,
    );

    const userPoolDomain = userPool.addDomain('HostedUiDomain', {
      cognitoDomain: { domainPrefix: `connected-enterprise-onboarding-${stage}-${Aws.ACCOUNT_ID}` },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    const userPoolClient = userPool.addClient('OnboardingSpaClient', {
      userPoolClientName: `connected-enterprise-onboarding-${stage}-spa`,
      generateSecret: false,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      authFlows: { userSrp: true },
      accessTokenValidity: Duration.minutes(15),
      idTokenValidity: Duration.minutes(15),
      refreshTokenValidity: Duration.days(1),
      refreshTokenRotationGracePeriod: Duration.seconds(10),
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      oAuth: {
        callbackUrls,
        logoutUrls,
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false, clientCredentials: false },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
      },
    });
    const managedLoginBranding = new cognito.CfnManagedLoginBranding(this, 'OnboardingManagedLoginBranding', {
      userPoolId: userPool.userPoolId,
      clientId: userPoolClient.userPoolClientId,
      useCognitoProvidedValues: true,
    });
    // Managed Login v2 is unavailable until every programmatically-created
    // app client has a branding style. Wait for the v2 domain before creating it.
    managedLoginBranding.addResourceDependency(userPoolDomain.node.defaultChild as cognito.CfnUserPoolDomain);

    const apiFunction = new lambdaNodejs.NodejsFunction(this, 'ApiFunction', {
      ...functionDefaults,
      functionName: `connected-enterprise-onboarding-${stage}-api`,
      entry: entry('api-handler.ts'),
      handler: 'handler',
      timeout: Duration.seconds(15),
      memorySize: 1024,
      reservedConcurrentExecutions: 50,
      logGroup: logGroup('api', logs.RetentionDays.THREE_MONTHS),
      environment: {
        TABLE_NAME: table.tableName,
        ARTIFACT_BUCKET: artifactBucket.bucketName,
        SIGNING_KEY_ID: signingKey.keyArn,
        STAGE: stage,
      },
    });
    table.grantReadWriteData(apiFunction);
    artifactBucket.grantReadWrite(apiFunction);
    signingKey.grantSign(apiFunction);

    const publicDeviceTestFunction = new lambdaNodejs.NodejsFunction(this, 'PublicDeviceTestFunction', {
      ...functionDefaults,
      functionName: `connected-enterprise-onboarding-${stage}-public-device-test`,
      entry: entry('public-device-test-handler.ts'),
      handler: 'handler',
      timeout: Duration.seconds(3),
      memorySize: 256,
      reservedConcurrentExecutions: 5,
      logGroup: logGroup('public-device-test'),
      environment: { STAGE: stage },
    });

    const gatewayConfigPullRoleName = `connected-enterprise-onboarding-${stage}-gateway-config-pull`;
    const deviceConfigHttpFunction = new lambdaNodejs.NodejsFunction(this, 'DeviceConfigHttpFunction', {
      ...functionDefaults,
      functionName: `connected-enterprise-onboarding-${stage}-device-config-http`,
      entry: entry('device-config-http-handler.ts'),
      handler: 'handler',
      timeout: Duration.seconds(10),
      reservedConcurrentExecutions: 50,
      logGroup: logGroup('device-config-http', logs.RetentionDays.THREE_MONTHS),
      environment: {
        TABLE_NAME: table.tableName,
        ARTIFACT_BUCKET: artifactBucket.bucketName,
        SIGNING_KEY_ID: signingKey.keyArn,
        AWS_ACCOUNT_ID: Aws.ACCOUNT_ID,
        GATEWAY_CONFIG_ROLE_NAME: gatewayConfigPullRoleName,
        STAGE: stage,
      },
    });
    deviceConfigHttpFunction.addToRolePolicy(new iam.PolicyStatement({
      sid: 'ReadAndRecordAuthorizedConfigurationDelivery',
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:TransactWriteItems'],
      resources: [table.tableArn, `${table.tableArn}/index/GSI1`],
    }));
    deviceConfigHttpFunction.addToRolePolicy(new iam.PolicyStatement({
      sid: 'ReadOnlyImmutableProfileArtifacts',
      actions: ['s3:GetObject'],
      resources: [artifactBucket.arnForObjects('*')],
    }));
    dataKey.grantDecrypt(deviceConfigHttpFunction);

    const deviceStatusHttpFunction = new lambdaNodejs.NodejsFunction(this, 'DeviceStatusHttpFunction', {
      ...functionDefaults,
      functionName: `connected-enterprise-onboarding-${stage}-device-status-http`,
      entry: entry('device-status-http-handler.ts'),
      handler: 'handler',
      timeout: Duration.seconds(10),
      reservedConcurrentExecutions: 50,
      logGroup: logGroup('device-status-http', logs.RetentionDays.THREE_MONTHS),
      environment: {
        TABLE_NAME: table.tableName,
        AWS_ACCOUNT_ID: Aws.ACCOUNT_ID,
        GATEWAY_CONFIG_ROLE_NAME: gatewayConfigPullRoleName,
        STAGE: stage,
      },
    });
    deviceStatusHttpFunction.addToRolePolicy(new iam.PolicyStatement({
      sid: 'ValidateAndRecordAuthorizedConfigurationStatus',
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:TransactWriteItems'],
      resources: [table.tableArn, `${table.tableArn}/index/GSI1`],
    }));

    const jwtAuthorizer = new apigwv2Authorizers.HttpJwtAuthorizer(
      'CognitoJwtAuthorizer',
      userPool.userPoolProviderUrl,
      { jwtAudience: [userPoolClient.userPoolClientId] },
    );
    const apiAccessLogs = dependOnDataKeyPolicy(new logs.LogGroup(this, 'ApiAccessLogGroup', {
      logGroupName: `/aws/apigateway/connected-enterprise-onboarding-${stage}`,
      retention: logs.RetentionDays.THREE_MONTHS,
      encryptionKey: dataKey,
      removalPolicy: RemovalPolicy.DESTROY,
    }));
    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `connected-enterprise-onboarding-${stage}`,
      description: 'Tenant-isolated gateway onboarding and immutable profile API',
      corsPreflight: {
        allowOrigins: allowedOrigins,
        allowMethods: [apigwv2.CorsHttpMethod.GET, apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        // API Gateway canonicalizes CORS header names to lowercase. Keep the
        // template canonical too so CloudFormation drift detection stays clean.
        allowHeaders: ['authorization', 'content-type', 'idempotency-key'],
        exposeHeaders: ['x-request-id'],
        maxAge: Duration.hours(1),
        allowCredentials: false,
      },
      createDefaultStage: true,
    });
    const apiIntegration = new apigwv2Integrations.HttpLambdaIntegration('ApiIntegration', apiFunction, {
      payloadFormatVersion: apigwv2.PayloadFormatVersion.VERSION_2_0,
    });
    const publicDeviceTestIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      'PublicDeviceTestIntegration',
      publicDeviceTestFunction,
      { payloadFormatVersion: apigwv2.PayloadFormatVersion.VERSION_2_0 },
    );
    const deviceConfigHttpIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      'DeviceConfigHttpIntegration',
      deviceConfigHttpFunction,
      { payloadFormatVersion: apigwv2.PayloadFormatVersion.VERSION_2_0 },
    );
    const deviceStatusHttpIntegration = new apigwv2Integrations.HttpLambdaIntegration(
      'DeviceStatusHttpIntegration',
      deviceStatusHttpFunction,
      { payloadFormatVersion: apigwv2.PayloadFormatVersion.VERSION_2_0 },
    );
    const addJwtRoute = (path: string, method: apigwv2.HttpMethod) => httpApi.addRoutes({
      path, methods: [method], authorizer: jwtAuthorizer, integration: apiIntegration,
    });
    addJwtRoute('/api/onboarding/snapshot', apigwv2.HttpMethod.GET);
    addJwtRoute('/api/onboarding/claims/verify', apigwv2.HttpMethod.POST);
    addJwtRoute('/api/onboarding/profiles', apigwv2.HttpMethod.POST);
    addJwtRoute('/api/onboarding/operations', apigwv2.HttpMethod.POST);
    addJwtRoute('/api/onboarding/operations/{operationId}', apigwv2.HttpMethod.GET);
    addJwtRoute('/api/onboarding/gateways/{gatewayId}/decommission', apigwv2.HttpMethod.POST);
    addJwtRoute('/api/onboarding/gateways/{gatewayId}/assignments', apigwv2.HttpMethod.POST);
    addJwtRoute('/profiles', apigwv2.HttpMethod.GET);
    addJwtRoute('/profiles', apigwv2.HttpMethod.POST);
    addJwtRoute('/profiles/{profileId}/versions', apigwv2.HttpMethod.POST);
    addJwtRoute('/gateways/{gatewayId}/assignments', apigwv2.HttpMethod.POST);
    const [publicDeviceTestRoute] = httpApi.addRoutes({
      path: '/device/v1/test/ping',
      methods: [apigwv2.HttpMethod.GET],
      integration: publicDeviceTestIntegration,
    });
    if (!publicDeviceTestRoute) throw new Error('Public device test route was not created');
    const deviceConfigRoutePath = '/device/v1/things/{thingName}/certificates/{certificateId}/configuration';
    const [deviceConfigRoute] = httpApi.addRoutes({
      path: deviceConfigRoutePath,
      methods: [apigwv2.HttpMethod.GET],
      authorizer: new apigwv2Authorizers.HttpIamAuthorizer(),
      integration: deviceConfigHttpIntegration,
    });
    if (!deviceConfigRoute) throw new Error('Secured device configuration route was not created');
    const deviceStatusRoutePath = '/device/v1/things/{thingName}/certificates/{certificateId}/status';
    const [deviceStatusRoute] = httpApi.addRoutes({
      path: deviceStatusRoutePath,
      methods: [apigwv2.HttpMethod.POST],
      authorizer: new apigwv2Authorizers.HttpIamAuthorizer(),
      integration: deviceStatusHttpIntegration,
    });
    if (!deviceStatusRoute) throw new Error('Secured device configuration status route was not created');
    const cfnDefaultStage = httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    // API Gateway rejects RouteSettings for a route that has not been created
    // yet. CloudFormation otherwise considers the stage and route independent,
    // so make their deployment order explicit.
    cfnDefaultStage.addResourceDependency(publicDeviceTestRoute.node.defaultChild as apigwv2.CfnRoute);
    cfnDefaultStage.addResourceDependency(deviceConfigRoute.node.defaultChild as apigwv2.CfnRoute);
    cfnDefaultStage.addResourceDependency(deviceStatusRoute.node.defaultChild as apigwv2.CfnRoute);
    cfnDefaultStage.accessLogSettings = {
      // `LogGroup.logGroupArn` includes a trailing `:*`, while API Gateway
      // persists the destination as the base log-group ARN. Render that base
      // ARN explicitly to avoid a permanent false-positive drift.
      destinationArn: `arn:${Aws.PARTITION}:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:${apiAccessLogs.logGroupName}`,
      format: JSON.stringify({
        requestId: '$context.requestId', requestTime: '$context.requestTime', httpMethod: '$context.httpMethod',
        routeKey: '$context.routeKey', status: '$context.status', responseLength: '$context.responseLength',
        integrationError: '$context.integrationErrorMessage', sourceIp: '$context.identity.sourceIp',
      }),
    };
    cfnDefaultStage.defaultRouteSettings = { throttlingBurstLimit: 100, throttlingRateLimit: 50 };
    cfnDefaultStage.addPropertyOverride('RouteSettings', {
      'GET /device/v1/test/ping': { ThrottlingBurstLimit: 5, ThrottlingRateLimit: 2 },
      [`GET ${deviceConfigRoutePath}`]: { ThrottlingBurstLimit: 100, ThrottlingRateLimit: 50 },
      [`POST ${deviceStatusRoutePath}`]: { ThrottlingBurstLimit: 100, ThrottlingRateLimit: 50 },
    });

    const operationalPolicyName = `ConnectedEnterpriseGatewayOperational-${stage}-v1`;
    const thingVariable = '${iot:Connection.Thing.ThingName}';
    const iotArn = (resource: string) => `arn:${Aws.PARTITION}:iot:${Aws.REGION}:${Aws.ACCOUNT_ID}:${resource}`;
    const operationalPolicy = new iot.CfnPolicy(this, 'OperationalPolicy', {
      policyName: operationalPolicyName,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow', Action: 'iot:Connect',
            Resource: iotArn(`client/${thingVariable}`),
            Condition: { Bool: { 'iot:Connection.Thing.IsAttached': 'true' } },
          },
          {
            Effect: 'Allow', Action: 'iot:Publish',
            Resource: [
              'config/request', 'status', 'onboarding/status', 'events', 'telemetry',
            ].map((suffix) => iotArn(`topic/ce/v1/gateways/${thingVariable}/${suffix}`)).concat([
              iotArn(`topic/$aws/things/${thingVariable}/jobs/*`),
              iotArn(`topic/$aws/things/${thingVariable}/shadow/name/configuration/*`),
            ]),
          },
          {
            // Receive and Subscribe use topic and topicfilter ARNs
            // respectively, so their exact union can share one statement
            // without creating a new valid action/resource pair.
            Effect: 'Allow', Action: ['iot:Receive', 'iot:Subscribe'],
            Resource: [
              iotArn(`topic/ce/v1/gateways/${thingVariable}/config/response`),
              iotArn(`topicfilter/ce/v1/gateways/${thingVariable}/config/response`),
              iotArn(`topic/$aws/things/${thingVariable}/jobs/*`),
              iotArn(`topic/$aws/things/${thingVariable}/shadow/name/configuration/*`),
              iotArn(`topicfilter/$aws/things/${thingVariable}/jobs/*`),
              iotArn(`topicfilter/$aws/things/${thingVariable}/shadow/name/configuration/*`),
            ],
          },
        ],
      },
    });

    const gatewayConfigRoleAliasName = `GatewayConfigPull-${stage}`;
    const gatewayConfigCredentialsPolicyName = `ConnectedEnterpriseGatewayConfigCredentials-${stage}-v1`;
    const gatewayConfigRoleAliasArn = iotArn(`rolealias/${gatewayConfigRoleAliasName}`);
    const credentialsThingName = '${credentials-iot:ThingName}';
    const credentialsCertificateId = '${credentials-iot:AwsCertificateId}';
    const gatewayConfigPullRole = new iam.Role(this, 'GatewayConfigPullRole', {
      roleName: gatewayConfigPullRoleName,
      description: 'IoT credential-provider role for a gateway to retrieve its own signed configuration and report its own status',
      assumedBy: new iam.ServicePrincipal('credentials.iot.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': Aws.ACCOUNT_ID },
          ArnEquals: { 'aws:SourceArn': gatewayConfigRoleAliasArn },
        },
      }),
      maxSessionDuration: Duration.hours(1),
    });
    gatewayConfigPullRole.addToPolicy(new iam.PolicyStatement({
      sid: 'InvokeOnlyOwnConfigurationRoutes',
      actions: ['execute-api:Invoke'],
      resources: [
        httpApi.arnForExecuteApi(
          'GET',
          `/device/v1/things/${credentialsThingName}/certificates/${credentialsCertificateId}/configuration`,
          '$default',
        ),
        httpApi.arnForExecuteApi(
          'POST',
          `/device/v1/things/${credentialsThingName}/certificates/${credentialsCertificateId}/status`,
          '$default',
        ),
      ],
    }));
    const gatewayConfigRoleAlias = new iot.CfnRoleAlias(this, 'GatewayConfigPullRoleAlias', {
      roleAlias: gatewayConfigRoleAliasName,
      roleArn: gatewayConfigPullRole.roleArn,
      credentialDurationSeconds: 3600,
      tags: [
        { key: 'Stage', value: stage },
        { key: 'Service', value: 'ConnectedEnterpriseGatewayConfigPull' },
      ],
    });
    const gatewayConfigCredentialsPolicy = new iot.CfnPolicy(this, 'GatewayConfigCredentialsPolicy', {
      policyName: gatewayConfigCredentialsPolicyName,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [{
          Sid: 'AssumeOnlyGatewayConfigPullRole',
          Effect: 'Allow',
          Action: 'iot:AssumeRoleWithCertificate',
          Resource: gatewayConfigRoleAliasArn,
        }],
      },
    });
    gatewayConfigCredentialsPolicy.node.addDependency(gatewayConfigRoleAlias);

    const thingType = new iot.CfnThingType(this, 'GatewayThingType', {
      thingTypeName: `ConnectedEnterpriseGateway-${stage}`,
      thingTypeProperties: { thingTypeDescription: `Connected Enterprise gateway (${stage})` },
    });
    const thingGroup = new iot.CfnThingGroup(this, 'GatewayThingGroup', {
      thingGroupName: `connected-enterprise-gateways-${stage}`,
      thingGroupProperties: { thingGroupDescription: `Connected Enterprise managed gateways (${stage})` },
    });

    const fleetTemplateName = `CEOnboarding-${stage}`;
    const fleetTemplateArn = iotArn(`provisioningtemplate/${fleetTemplateName}`);
    const bootstrapClientIdPrefix = 'claim-';
    const preProvisionFunction = new lambdaNodejs.NodejsFunction(this, 'PreProvisionFunction', {
      ...functionDefaults,
      functionName: `connected-enterprise-onboarding-${stage}-pre-provision`,
      entry: entry('pre-provision-hook.ts'),
      handler: 'handler',
      timeout: Duration.seconds(5),
      reservedConcurrentExecutions: 20,
      logGroup: logGroup('pre-provision', logs.RetentionDays.THREE_MONTHS),
      environment: {
        TABLE_NAME: table.tableName,
        PROVISIONING_TEMPLATE_ARN: fleetTemplateArn,
        BOOTSTRAP_CLIENT_ID_PREFIX: bootstrapClientIdPrefix,
        AWS_ACCOUNT_ID: Aws.ACCOUNT_ID,
        STAGE: stage,
      },
    });
    table.grantReadWriteData(preProvisionFunction);

    const provisioningRole = new iam.Role(this, 'FleetProvisioningRole', {
      roleName: `connected-enterprise-onboarding-${stage}-fleet-provisioning`,
      description: 'Dev-only IoT Fleet Provisioning registration role for unique preloaded gateway bootstrap identities',
      assumedBy: new iam.ServicePrincipal('iot.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': Aws.ACCOUNT_ID },
          ArnEquals: { 'aws:SourceArn': fleetTemplateArn },
        },
      }),
      maxSessionDuration: Duration.hours(1),
    });
    // This stack is runtime-enforced as dev-only above. AWS does not publish the
    // subordinate RegisterThing call graph, so use its supported registration
    // service-role policy for demo reliability. The inline statements below
    // retain the intended least-privilege baseline for a future production stack.
    provisioningRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSIoTThingsRegistration'),
    );
    provisioningRole.addToPolicy(new iam.PolicyStatement({
      sid: 'RegisterThingForFleetProvisioning',
      actions: ['iot:RegisterThing'],
      resources: ['*'],
    }));
    provisioningRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ManageExactGatewayResources',
      actions: ['iot:CreateThing', 'iot:DescribeThing', 'iot:UpdateThing'],
      resources: [iotArn('thing/gw-*')],
    }));
    provisioningRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AttachIssuedCertificateToGatewayThing',
      actions: ['iot:AttachThingPrincipal'],
      resources: [iotArn('cert/*')],
      conditions: { ArnLike: { 'iot:thingArn': iotArn('thing/gw-*') } },
    }));
    provisioningRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ActivateIssuedCertificate',
      actions: ['iot:UpdateCertificate', 'iot:DescribeCertificate'],
      resources: [iotArn('cert/*')],
    }));
    provisioningRole.addToPolicy(new iam.PolicyStatement({
      sid: 'AttachExistingOperationalPolicy',
      actions: ['iot:AttachPolicy'],
      resources: [iotArn('cert/*')],
    }));
    provisioningRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ReadExistingOperationalPolicy',
      actions: ['iot:GetPolicy'],
      resources: [
        iotArn(`policy/${operationalPolicyName}`),
        iotArn(`policy/${gatewayConfigCredentialsPolicyName}`),
      ],
    }));
    provisioningRole.addToPolicy(new iam.PolicyStatement({
      sid: 'UseExactGroupAndType',
      actions: ['iot:AddThingToThingGroup'],
      resources: [iotArn(`thinggroup/${thingGroup.thingGroupName}`), iotArn('thing/gw-*')],
    }));
    provisioningRole.addToPolicy(new iam.PolicyStatement({
      sid: 'DescribeExactGatewayGroup',
      actions: ['iot:DescribeThingGroup'],
      resources: [iotArn(`thinggroup/${thingGroup.thingGroupName}`)],
    }));
    provisioningRole.addToPolicy(new iam.PolicyStatement({
      sid: 'DescribeExactGatewayType',
      actions: ['iot:DescribeThingType'],
      resources: [iotArn(`thingtype/${thingType.thingTypeName}`)],
    }));
    provisioningRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ListExactGatewayThingGroups',
      actions: ['iot:ListThingGroupsForThing'],
      resources: [iotArn('thing/gw-*')],
    }));
    provisioningRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ListExactGatewayThingPrincipals',
      actions: ['iot:ListThingPrincipals'],
      resources: [iotArn('thing/gw-*')],
    }));
    provisioningRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ListIssuedCertificateThings',
      actions: ['iot:ListPrincipalThings'],
      resources: [iotArn('cert/*')],
    }));
    provisioningRole.addToPolicy(new iam.PolicyStatement({
      sid: 'ListIssuedCertificatePolicies',
      actions: ['iot:ListAttachedPolicies'],
      resources: [iotArn('cert/*')],
    }));

    const templateBody = JSON.stringify({
      Parameters: {
        SerialNumber: { Type: 'String' },
        HardwareId: { Type: 'String', Default: '' },
        HardwareProof: { Type: 'String', Default: '' },
        ThingName: { Type: 'String', Default: 'hook-must-override' },
        GatewayId: { Type: 'String', Default: 'hook-must-override' },
        TenantId: { Type: 'String', Default: 'hook-must-override' },
      },
      Resources: {
        certificate: {
          Type: 'AWS::IoT::Certificate',
          Properties: {
            CertificateId: { Ref: 'AWS::IoT::Certificate::Id' },
            Status: 'ACTIVE',
            ThingPrincipalType: 'EXCLUSIVE_THING',
          },
        },
        thing: {
          Type: 'AWS::IoT::Thing',
          Properties: {
            ThingName: { Ref: 'ThingName' },
            ThingTypeName: thingType.thingTypeName,
            ThingGroups: [thingGroup.thingGroupName],
            AttributePayload: {
              serialNumber: { Ref: 'SerialNumber' },
              gatewayId: { Ref: 'GatewayId' },
              tenantId: { Ref: 'TenantId' },
            },
          },
          OverrideSettings: { AttributePayload: 'REPLACE', ThingTypeName: 'REPLACE', ThingGroups: 'REPLACE' },
        },
        policy: { Type: 'AWS::IoT::Policy', Properties: { PolicyName: operationalPolicyName } },
        configCredentialsPolicy: {
          Type: 'AWS::IoT::Policy',
          Properties: { PolicyName: gatewayConfigCredentialsPolicyName },
        },
      },
    });
    const fleetTemplate = new iot.CfnProvisioningTemplate(this, 'FleetProvisioningTemplate', {
      templateName: fleetTemplateName,
      description: 'Serial enrollment from a unique preloaded bootstrap certificate; ownership parameters are authorized and overridden by the pre-provision hook',
      enabled: true,
      provisioningRoleArn: provisioningRole.roleArn,
      preProvisioningHook: { payloadVersion: '2020-04-01', targetArn: preProvisionFunction.functionArn },
      templateBody,
    });
    fleetTemplate.node.addDependency(
      operationalPolicy,
      gatewayConfigCredentialsPolicy,
      gatewayConfigRoleAlias,
      thingType,
      thingGroup,
      provisioningRole,
    );
    preProvisionFunction.addPermission('AllowExactFleetTemplateHook', {
      principal: new iam.ServicePrincipal('iot.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceAccount: Aws.ACCOUNT_ID,
      sourceArn: fleetTemplateArn,
    });

    const bootstrapClaimPolicyName = `ConnectedEnterpriseGatewayBootstrap-${stage}-v1`;
    const bootstrapClaimPolicy = new iot.CfnPolicy(this, 'BootstrapClaimPolicy', {
      policyName: bootstrapClaimPolicyName,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'ConnectWithRandomClaimClientId', Effect: 'Allow', Action: 'iot:Connect',
            Resource: iotArn(`client/${bootstrapClientIdPrefix}*`),
          },
          {
            Sid: 'PublishOnlyCertificateCreationAndRegisterThing', Effect: 'Allow', Action: 'iot:Publish',
            Resource: [
              iotArn('topic/$aws/certificates/create/json'),
              iotArn('topic/$aws/certificates/create-from-csr/json'),
              iotArn(`topic/$aws/provisioning-templates/${fleetTemplateName}/provision/json`),
            ],
          },
          {
            Sid: 'SubscribeOnlyProvisioningResponses', Effect: 'Allow', Action: 'iot:Subscribe',
            Resource: [
              iotArn('topicfilter/$aws/certificates/create/json/accepted'),
              iotArn('topicfilter/$aws/certificates/create/json/rejected'),
              iotArn('topicfilter/$aws/certificates/create-from-csr/json/accepted'),
              iotArn('topicfilter/$aws/certificates/create-from-csr/json/rejected'),
              iotArn(`topicfilter/$aws/provisioning-templates/${fleetTemplateName}/provision/json/accepted`),
              iotArn(`topicfilter/$aws/provisioning-templates/${fleetTemplateName}/provision/json/rejected`),
            ],
          },
          {
            Sid: 'ReceiveOnlyProvisioningResponses', Effect: 'Allow', Action: 'iot:Receive',
            Resource: [
              iotArn('topic/$aws/certificates/create/json/accepted'),
              iotArn('topic/$aws/certificates/create/json/rejected'),
              iotArn('topic/$aws/certificates/create-from-csr/json/accepted'),
              iotArn('topic/$aws/certificates/create-from-csr/json/rejected'),
              iotArn(`topic/$aws/provisioning-templates/${fleetTemplateName}/provision/json/accepted`),
              iotArn(`topic/$aws/provisioning-templates/${fleetTemplateName}/provision/json/rejected`),
            ],
          },
        ],
      },
    });
    bootstrapClaimPolicy.node.addDependency(fleetTemplate);

    const endpointLookup = new cr.AwsCustomResource(this, 'IotDataEndpointLookup', {
      installLatestAwsSdk: false,
      onCreate: {
        service: 'Iot', action: 'describeEndpoint', parameters: { endpointType: 'iot:Data-ATS' },
        physicalResourceId: cr.PhysicalResourceId.fromResponse('endpointAddress'),
      },
      onUpdate: {
        service: 'Iot', action: 'describeEndpoint', parameters: { endpointType: 'iot:Data-ATS' },
        physicalResourceId: cr.PhysicalResourceId.fromResponse('endpointAddress'),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([new iam.PolicyStatement({
        actions: ['iot:DescribeEndpoint'], resources: ['*'],
      })]),
    });
    const iotDataEndpoint = endpointLookup.getResponseField('endpointAddress');
    const credentialProviderEndpointLookup = new cr.AwsCustomResource(this, 'IotCredentialProviderEndpointLookup', {
      installLatestAwsSdk: false,
      onCreate: {
        service: 'Iot', action: 'describeEndpoint', parameters: { endpointType: 'iot:CredentialProvider' },
        physicalResourceId: cr.PhysicalResourceId.fromResponse('endpointAddress'),
      },
      onUpdate: {
        service: 'Iot', action: 'describeEndpoint', parameters: { endpointType: 'iot:CredentialProvider' },
        physicalResourceId: cr.PhysicalResourceId.fromResponse('endpointAddress'),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([new iam.PolicyStatement({
        actions: ['iot:DescribeEndpoint'], resources: ['*'],
      })]),
    });
    const iotCredentialProviderEndpoint = credentialProviderEndpointLookup.getResponseField('endpointAddress');

    const jobTemplate = new iot.CfnJobTemplate(this, 'ProfileApplyJobTemplate', {
      jobTemplateId: `connected-enterprise-profile-apply-${stage}-v1`,
      description: 'Apply a signed Connected Enterprise profile assignment descriptor',
      document: JSON.stringify({
        schemaVersion: '1.0',
        operation: 'FETCH_DESIRED_PROFILE',
        shadowName: 'configuration',
        detail: 'Read the named configuration shadow, then fetch and verify the signed immutable profile.',
      }),
      timeoutConfig: { InProgressTimeoutInMinutes: 30 },
    });

    const outboxDlq = new sqs.Queue(this, 'OutboxDlq', {
      queueName: `connected-enterprise-onboarding-${stage}-outbox-dlq`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: dataKey,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });
    const ruleErrorQueue = new sqs.Queue(this, 'IotRuleErrorQueue', {
      queueName: `connected-enterprise-onboarding-${stage}-iot-rule-errors`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: dataKey,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });
    const configAsyncFailureQueue = new sqs.Queue(this, 'IotConfigAsyncFailureQueue', {
      queueName: `connected-enterprise-onboarding-${stage}-iot-config-async-dlq`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: dataKey,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });
    const statusAsyncFailureQueue = new sqs.Queue(this, 'IotStatusAsyncFailureQueue', {
      queueName: `connected-enterprise-onboarding-${stage}-iot-status-async-dlq`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: dataKey,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });

    const outboxFunction = new lambdaNodejs.NodejsFunction(this, 'OutboxFunction', {
      ...functionDefaults,
      functionName: `connected-enterprise-onboarding-${stage}-outbox`,
      entry: entry('outbox-handler.ts'),
      handler: 'handler',
      timeout: Duration.seconds(30),
      reservedConcurrentExecutions: 25,
      logGroup: logGroup('outbox', logs.RetentionDays.THREE_MONTHS),
      environment: {
        TABLE_NAME: table.tableName, IOT_DATA_ENDPOINT: iotDataEndpoint,
        JOB_TEMPLATE_ARN: jobTemplate.attrArn, AWS_ACCOUNT_ID: Aws.ACCOUNT_ID, STAGE: stage,
      },
    });
    table.grantReadWriteData(outboxFunction);
    outboxFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iot:UpdateThingShadow'],
      resources: [iotArn('thing/gw-*')],
    }));
    outboxFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iot:CreateJob', 'iot:DescribeJob'],
      resources: [iotArn('job/ce-*'), iotArn('thing/gw-*'), jobTemplate.attrArn],
    }));
    outboxFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iot:UpdateCertificate'], resources: [iotArn('cert/*')],
    }));
    outboxFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iot:DeleteConnection'], resources: [iotArn('client/gw-*')],
    }));
    const streamTable = dynamodb.Table.fromTableAttributes(this, 'ControlPlaneStreamReference', {
      tableArn: table.tableArn,
      tableStreamArn: table.tableStreamArn!,
    });
    outboxFunction.addEventSource(new lambdaEventSources.DynamoEventSource(streamTable, {
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 10,
      maxBatchingWindow: Duration.seconds(1),
      bisectBatchOnError: true,
      retryAttempts: 10,
      maxRecordAge: Duration.minutes(15),
      parallelizationFactor: 2,
      reportBatchItemFailures: true,
      onFailure: new lambdaEventSources.SqsDlq(outboxDlq),
      filters: [lambda.FilterCriteria.filter({
        eventName: lambda.FilterRule.isEqual('INSERT'),
        dynamodb: { NewImage: { entityType: { S: lambda.FilterRule.isEqual('OUTBOX') } } },
      })],
    }));

    const iotConfigFunction = new lambdaNodejs.NodejsFunction(this, 'IotConfigFunction', {
      ...functionDefaults,
      functionName: `connected-enterprise-onboarding-${stage}-iot-config`,
      entry: entry('iot-config-handler.ts'),
      handler: 'handler',
      timeout: Duration.seconds(10),
      reservedConcurrentExecutions: 50,
      logGroup: logGroup('iot-config', logs.RetentionDays.THREE_MONTHS),
      environment: {
        TABLE_NAME: table.tableName, ARTIFACT_BUCKET: artifactBucket.bucketName,
        IOT_DATA_ENDPOINT: iotDataEndpoint, SIGNING_KEY_ID: signingKey.keyArn,
        AWS_ACCOUNT_ID: Aws.ACCOUNT_ID, STAGE: stage,
      },
    });
    table.grantReadWriteData(iotConfigFunction);
    artifactBucket.grantRead(iotConfigFunction);
    iotConfigFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iot:Publish'], resources: [iotArn('topic/ce/v1/gateways/*/config/response')],
    }));

    const iotStatusFunction = new lambdaNodejs.NodejsFunction(this, 'IotStatusFunction', {
      ...functionDefaults,
      functionName: `connected-enterprise-onboarding-${stage}-iot-status`,
      entry: entry('iot-status-handler.ts'),
      handler: 'handler',
      timeout: Duration.seconds(10),
      reservedConcurrentExecutions: 50,
      logGroup: logGroup('iot-status', logs.RetentionDays.THREE_MONTHS),
      environment: { TABLE_NAME: table.tableName, AWS_ACCOUNT_ID: Aws.ACCOUNT_ID, STAGE: stage },
    });
    table.grantReadWriteData(iotStatusFunction);
    new lambda.EventInvokeConfig(this, 'IotConfigEventInvokeConfig', {
      function: iotConfigFunction,
      retryAttempts: 2,
      maxEventAge: Duration.minutes(5),
      onFailure: new lambdaDestinations.SqsDestination(configAsyncFailureQueue),
    });
    new lambda.EventInvokeConfig(this, 'IotStatusEventInvokeConfig', {
      function: iotStatusFunction,
      retryAttempts: 2,
      maxEventAge: Duration.minutes(5),
      onFailure: new lambdaDestinations.SqsDestination(statusAsyncFailureQueue),
    });

    const ruleActionRole = new iam.Role(this, 'IotRuleErrorRole', {
      roleName: `connected-enterprise-onboarding-${stage}-iot-rule-error`,
      assumedBy: new iam.ServicePrincipal('iot.amazonaws.com', {
        conditions: {
          StringEquals: { 'aws:SourceAccount': Aws.ACCOUNT_ID },
          ArnLike: { 'aws:SourceArn': iotArn(`rule/connected_enterprise_*_${stage}`) },
        },
      }),
    });
    ruleErrorQueue.grantSendMessages(ruleActionRole);
    const ruleErrorAction: iot.CfnTopicRule.ActionProperty = {
      sqs: { queueUrl: ruleErrorQueue.queueUrl, roleArn: ruleActionRole.roleArn, useBase64: false },
    };
    const brokerIdentitySelect = 'principal() AS brokerPrincipal, clientid() AS brokerClientId, topic() AS brokerTopic, traceid() AS brokerTraceId, timestamp() AS brokerReceivedAt';
    const configRuleName = `connected_enterprise_config_${stage}`;
    const configRule = new iot.CfnTopicRule(this, 'ConfigRequestRule', {
      ruleName: configRuleName,
      topicRulePayload: {
        awsIotSqlVersion: '2016-03-23', ruleDisabled: false,
        description: 'Broker-authenticated gateway profile requests',
        sql: `SELECT generation, requestId, ${brokerIdentitySelect} FROM 'ce/v1/gateways/+/config/request'`,
        actions: [{ lambda: { functionArn: iotConfigFunction.functionArn } }], errorAction: ruleErrorAction,
      },
    });
    iotConfigFunction.addPermission('AllowExactConfigRule', {
      principal: new iam.ServicePrincipal('iot.amazonaws.com'), action: 'lambda:InvokeFunction',
      sourceAccount: Aws.ACCOUNT_ID, sourceArn: iotArn(`rule/${configRuleName}`),
    });
    configRule.node.addDependency(ruleActionRole);

    const statusRuleName = `connected_enterprise_status_${stage}`;
    const statusRule = new iot.CfnTopicRule(this, 'ConfigStatusRule', {
      ruleName: statusRuleName,
      topicRulePayload: {
        awsIotSqlVersion: '2016-03-23', ruleDisabled: false,
        description: 'Broker-authenticated gateway apply and health status',
        sql: `SELECT generation, status, profileVersionId, profileChecksum, detail, error, ${brokerIdentitySelect} FROM 'ce/v1/gateways/+/status'`,
        actions: [{ lambda: { functionArn: iotStatusFunction.functionArn } }], errorAction: ruleErrorAction,
      },
    });
    iotStatusFunction.addPermission('AllowExactStatusRule', {
      principal: new iam.ServicePrincipal('iot.amazonaws.com'), action: 'lambda:InvokeFunction',
      sourceAccount: Aws.ACCOUNT_ID, sourceArn: iotArn(`rule/${statusRuleName}`),
    });
    statusRule.node.addDependency(ruleActionRole);

    const apiServerErrors = new cloudwatch.Alarm(this, 'ApiServerErrorAlarm', {
      alarmName: `connected-enterprise-onboarding-${stage}-api-5xx`,
      metric: httpApi.metricServerError({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const lambdaErrors = [
      apiFunction,
      preProvisionFunction,
      iotConfigFunction,
      iotStatusFunction,
      outboxFunction,
      // Keep existing positions stable so adding this function does not
      // replace every previously deployed Lambda alarm.
      deviceConfigHttpFunction,
    ];
    lambdaErrors.forEach((fn, index) => new cloudwatch.Alarm(this, `LambdaErrorsAlarm${index}`, {
      alarmName: `${fn.functionName}-errors`,
      metric: fn.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }));
    const ruleErrorAlarm = new cloudwatch.Alarm(this, 'IotRuleErrorAlarm', {
      alarmName: `connected-enterprise-onboarding-${stage}-iot-rule-dlq`,
      metric: ruleErrorQueue.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5), statistic: 'Maximum' }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const outboxDlqAlarm = new cloudwatch.Alarm(this, 'OutboxDlqAlarm', {
      alarmName: `connected-enterprise-onboarding-${stage}-outbox-dlq`,
      metric: outboxDlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5), statistic: 'Maximum' }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const configAsyncDlqAlarm = new cloudwatch.Alarm(this, 'IotConfigAsyncDlqAlarm', {
      alarmName: `connected-enterprise-onboarding-${stage}-iot-config-async-dlq`,
      metric: configAsyncFailureQueue.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5), statistic: 'Maximum' }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const statusAsyncDlqAlarm = new cloudwatch.Alarm(this, 'IotStatusAsyncDlqAlarm', {
      alarmName: `connected-enterprise-onboarding-${stage}-iot-status-async-dlq`,
      metric: statusAsyncFailureQueue.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5), statistic: 'Maximum' }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    apiServerErrors.node.addDependency(cfnDefaultStage);
    ruleErrorAlarm.node.addDependency(configRule, statusRule);
    outboxDlqAlarm.node.addDependency(outboxFunction);
    configAsyncDlqAlarm.node.addDependency(iotConfigFunction);
    statusAsyncDlqAlarm.node.addDependency(iotStatusFunction);

    new CfnOutput(this, 'ApiUrl', {
      value: httpApi.apiEndpoint,
      description: 'Onboarding HTTP API base URL; browser routes require JWT and device configuration/status routes require AWS_IAM',
    });
    new CfnOutput(this, 'PublicDeviceTestUrl', {
      value: `${httpApi.apiEndpoint}/device/v1/test/ping`,
      description: 'Unauthenticated dev-only static gateway HTTP connectivity probe; never returns configuration data',
    });
    new CfnOutput(this, 'DeviceConfigurationUrlTemplate', {
      value: `${httpApi.apiEndpoint}${deviceConfigRoutePath}`,
      description: 'AWS_IAM-protected inline configuration endpoint; Thing and certificate path values are bound by IoT-issued credentials',
    });
    new CfnOutput(this, 'DeviceStatusUrlTemplate', {
      value: `${httpApi.apiEndpoint}${deviceStatusRoutePath}`,
      description: 'AWS_IAM-protected device status endpoint; Thing and certificate path values are bound by IoT-issued credentials',
    });
    new CfnOutput(this, 'CognitoIssuer', { value: userPool.userPoolProviderUrl, description: 'JWT issuer used by API Gateway' });
    new CfnOutput(this, 'CognitoUserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'CognitoSpaClientId', { value: userPoolClient.userPoolClientId, description: 'Public SPA client (authorization code + PKCE; no secret)' });
    new CfnOutput(this, 'CognitoHostedUiBaseUrl', { value: userPoolDomain.baseUrl() });
    new CfnOutput(this, 'CognitoOAuthCallbackUrls', { value: callbackUrls.join(',') });
    new CfnOutput(this, 'CognitoOAuthLogoutUrls', { value: logoutUrls.join(',') });
    new CfnOutput(this, 'ControlPlaneTableName', { value: table.tableName });
    new CfnOutput(this, 'ArtifactBucketName', { value: artifactBucket.bucketName });
    new CfnOutput(this, 'ProfileSigningKeyArn', { value: signingKey.keyArn, description: 'Public-key export is an explicit operator step; no private key exists outside KMS' });
    new CfnOutput(this, 'HardwareProofSecretArn', { value: hardwareProofPepper.secretArn, description: 'Reserved for a future hardware-proof migration; unused by current onboarding Lambdas' });
    new CfnOutput(this, 'IotConfigAsyncFailureQueueUrl', { value: configAsyncFailureQueue.queueUrl });
    new CfnOutput(this, 'IotStatusAsyncFailureQueueUrl', { value: statusAsyncFailureQueue.queueUrl });
    new CfnOutput(this, 'IotDataEndpoint', { value: iotDataEndpoint });
    new CfnOutput(this, 'IotCredentialProviderEndpoint', { value: iotCredentialProviderEndpoint });
    new CfnOutput(this, 'GatewayConfigRoleAliasName', { value: gatewayConfigRoleAliasName });
    new CfnOutput(this, 'GatewayConfigCredentialsPolicyName', { value: gatewayConfigCredentialsPolicyName });
    new CfnOutput(this, 'FleetProvisioningTemplateName', { value: fleetTemplateName });
    new CfnOutput(this, 'OperationalPolicyName', { value: operationalPolicyName });
    new CfnOutput(this, 'BootstrapClaimPolicyName', {
      value: bootstrapClaimPolicyName,
      description: 'Bootstrap policy attached individually to each unique preloaded gateway certificate by the manufacturing bootstrap process.',
    });
    new CfnOutput(this, 'ConfigShadowName', { value: 'configuration' });
    new CfnOutput(this, 'ProfileApplyJobTemplateArn', { value: jobTemplate.attrArn });
  }
}
