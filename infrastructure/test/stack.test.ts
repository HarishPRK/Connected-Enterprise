import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from 'aws-lambda';

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { ConnectedEnterpriseOnboardingStack, requireUrlList } from '../lib/connected-enterprise-onboarding-stack.js';
import { validateUiProfileParameters } from '../lambda/shared/ui-profile.js';
import { assertProfileCompatibility, assertProfileLineageModel } from '../lambda/shared/compatibility.js';
import { assertUniqueCanonicalSerials, requireCanonicalSerial } from '../lambda/shared/manufacturing-credentials.js';

process.env.TABLE_NAME ??= 'connected-enterprise-onboarding-unit-test';
process.env.IOT_DATA_ENDPOINT ??= 'example-ats.iot.us-east-1.amazonaws.com';
process.env.AWS_ACCOUNT_ID ??= '111122223333';
process.env.AWS_REGION ??= 'us-east-1';

function synthesized(): Template {
  const app = new cdk.App({
    context: {
      stage: 'dev',
      allowedOrigins: ['http://localhost:5174'],
      oauthCallbackUrls: ['http://localhost:5174/onboarding'],
      oauthLogoutUrls: ['http://localhost:5174/onboarding'],
    },
  });
  const stack = new ConnectedEnterpriseOnboardingStack(app, 'ConnectedEnterpriseOnboarding-dev', {
    stage: 'dev',
    stackName: 'ConnectedEnterpriseOnboarding-dev',
    env: { account: '111122223333', region: 'us-east-1' },
  });
  return Template.fromStack(stack);
}

function resolvePolicyIntrinsics(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(resolvePolicyIntrinsics);
  if (value === null || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  if (typeof record.Ref === 'string') {
    const pseudoParameters: Record<string, string> = {
      'AWS::Partition': 'aws',
      'AWS::Region': 'us-east-1',
      'AWS::AccountId': '111122223333',
    };
    assert.ok(record.Ref in pseudoParameters, `unexpected policy Ref: ${record.Ref}`);
    return pseudoParameters[record.Ref];
  }

  const join = record['Fn::Join'];
  if (Array.isArray(join) && join.length === 2 && typeof join[0] === 'string' && Array.isArray(join[1])) {
    return join[1].map((part) => String(resolvePolicyIntrinsics(part))).join(join[0]);
  }

  return Object.fromEntries(Object.entries(record).map(([key, nested]) => [key, resolvePolicyIntrinsics(nested)]));
}

test('stack synthesizes encrypted retained sources of truth and immutable artifacts', () => {
  const template = synthesized();
  template.hasResourceProperties('AWS::DynamoDB::Table', {
    TableName: 'connected-enterprise-onboarding-dev',
    DeletionProtectionEnabled: true,
    PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    StreamSpecification: { StreamViewType: 'NEW_AND_OLD_IMAGES' },
    SSESpecification: { SSEEnabled: true, SSEType: 'KMS' },
    TimeToLiveSpecification: { AttributeName: 'expiresAtEpoch', Enabled: true },
  });
  template.hasResourceProperties('AWS::S3::Bucket', {
    VersioningConfiguration: { Status: 'Enabled' },
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true,
    },
    BucketEncryption: Match.anyValue(),
  });
  template.hasResourceProperties('AWS::KMS::Key', {
    KeySpec: 'ECC_NIST_P256',
    KeyUsage: 'SIGN_VERIFY',
  });
});

test('encrypted LogGroups wait for a namespace-scoped CloudWatch Logs KMS grant', () => {
  const template = synthesized();
  const rendered = template.toJSON() as {
    Resources: Record<string, {
      Type: string;
      Properties?: Record<string, unknown>;
      DependsOn?: string | string[];
    }>;
  };
  const dataKeyEntry = Object.entries(rendered.Resources).find(([, resource]) =>
    resource.Type === 'AWS::KMS::Key'
    && resource.Properties?.Description === 'Connected Enterprise onboarding dev data encryption');
  assert.ok(dataKeyEntry, 'data-encryption KMS key is present');
  const [dataKeyLogicalId, dataKeyResource] = dataKeyEntry;
  const keyPolicy = dataKeyResource.Properties?.KeyPolicy as {
    Statement: Array<Record<string, unknown>>;
  };
  const logsStatement = keyPolicy.Statement.find((statement) =>
    statement.Sid === 'AllowCloudWatchLogsForOnboardingLogGroups');
  assert.ok(logsStatement, 'CloudWatch Logs KMS statement is present');

  const resolvedStatement = resolvePolicyIntrinsics(logsStatement) as {
    Action: string[];
    Effect: string;
    Principal: { Service: string };
    Resource: string;
    Condition: { ArnLike: { 'kms:EncryptionContext:aws:logs:arn': string[] } };
  };
  assert.equal(resolvedStatement.Principal.Service, 'logs.us-east-1.amazonaws.com');
  assert.equal(resolvedStatement.Effect, 'Allow');
  assert.equal(resolvedStatement.Resource, '*');
  assert.deepEqual(new Set(resolvedStatement.Action), new Set([
    'kms:Encrypt',
    'kms:Decrypt',
    'kms:ReEncrypt*',
    'kms:GenerateDataKey*',
    'kms:DescribeKey',
  ]));
  assert.deepEqual(
    resolvedStatement.Condition.ArnLike['kms:EncryptionContext:aws:logs:arn'],
    [
      'arn:aws:logs:us-east-1:111122223333:log-group:/aws/lambda/connected-enterprise-onboarding-dev-*',
      'arn:aws:logs:us-east-1:111122223333:log-group:/aws/apigateway/connected-enterprise-onboarding-dev',
    ],
  );

  const logGroups = Object.entries(rendered.Resources).filter(([, resource]) => resource.Type === 'AWS::Logs::LogGroup');
  assert.equal(logGroups.length, 10, 'every application/API LogGroup is explicitly declared');
  for (const [logicalId, resource] of logGroups) {
    assert.deepEqual(resource.Properties?.KmsKeyId, { 'Fn::GetAtt': [dataKeyLogicalId, 'Arn'] },
      `${logicalId} uses the DataKey`);
    const dependencies = Array.isArray(resource.DependsOn)
      ? resource.DependsOn
      : resource.DependsOn === undefined ? [] : [resource.DependsOn];
    assert.ok(dependencies.includes(dataKeyLogicalId), `${logicalId} waits for the DataKey policy`);
  }
});

test('Cognito is a hosted authorization-code PKCE SPA with V2 tenant claims', () => {
  const template = synthesized();
  template.hasResourceProperties('AWS::Cognito::UserPool', {
    DeletionProtection: 'ACTIVE',
    MfaConfiguration: 'ON',
    UserPoolTier: 'ESSENTIALS',
    LambdaConfig: { PreTokenGenerationConfig: { LambdaVersion: 'V2_0', LambdaArn: Match.anyValue() } },
  });
  template.resourceCountIs('AWS::Cognito::UserPoolDomain', 1);
  template.resourceCountIs('AWS::Cognito::ManagedLoginBranding', 1);
  template.hasResourceProperties('AWS::Cognito::ManagedLoginBranding', {
    ClientId: Match.anyValue(),
    UserPoolId: Match.anyValue(),
    UseCognitoProvidedValues: true,
  });
  template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
    GenerateSecret: false,
    AllowedOAuthFlows: ['code'],
    CallbackURLs: ['http://localhost:5174/onboarding'],
    LogoutURLs: ['http://localhost:5174/onboarding'],
  });
  template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
    AuthorizerType: 'JWT',
    IdentitySource: ['$request.header.Authorization'],
  });
  template.hasOutput('CognitoIssuer', {});
  template.hasOutput('CognitoSpaClientId', {});
  template.hasOutput('CognitoHostedUiBaseUrl', {});
});

test('Fleet Provisioning accepts both certificate APIs, remains hook-gated and exclusive, and uses named policies', () => {
  const template = synthesized();
  const rendered = template.toJSON() as { Resources: Record<string, { Type: string; Properties?: Record<string, unknown> }> };
  const fleet = Object.values(rendered.Resources).find((resource) => resource.Type === 'AWS::IoT::ProvisioningTemplate');
  assert.ok(fleet?.Properties, 'Fleet provisioning template is present');
  const fleetJson = JSON.stringify(fleet.Properties);
  assert.match(fleetJson, /EXCLUSIVE_THING/);
  assert.match(fleetJson, /ConnectedEnterpriseGatewayOperational-dev-v1/);
  assert.match(fleetJson, /PreProvisioningHook/);

  const provisioningTemplateBody = fleet.Properties.TemplateBody;
  assert.ok(typeof provisioningTemplateBody === 'string', 'Fleet provisioning template body is JSON text');
  const parsedProvisioningTemplate = JSON.parse(provisioningTemplateBody) as {
    Parameters: Record<string, { Type: string; Default?: string }>;
    Resources: {
      certificate: { Type: string; Properties: Record<string, unknown> };
      thing: {
        Type: string;
        Properties: { AttributePayload: Record<string, unknown>; [key: string]: unknown };
        OverrideSettings: Record<string, string>;
      };
      policy: { Type: string; Properties: Record<string, unknown> };
      configCredentialsPolicy: { Type: string; Properties: Record<string, unknown> };
    };
  };
  assert.deepEqual(parsedProvisioningTemplate.Parameters.SerialNumber, { Type: 'String' });
  assert.deepEqual(parsedProvisioningTemplate.Parameters.HardwareId, { Type: 'String', Default: '' },
    'legacy HardwareId is optional and ignored by the serial-only hook');
  assert.deepEqual(parsedProvisioningTemplate.Parameters.HardwareProof, { Type: 'String', Default: '' },
    'legacy HardwareProof is optional and ignored by the serial-only hook');
  const thingTemplate = parsedProvisioningTemplate.Resources.thing;
  assert.equal(thingTemplate.Type, 'AWS::IoT::Thing');
  assert.deepEqual(thingTemplate.Properties.AttributePayload, {
    serialNumber: { Ref: 'SerialNumber' },
    gatewayId: { Ref: 'GatewayId' },
    tenantId: { Ref: 'TenantId' },
  }, 'Thing AttributePayload is the direct, three-entry provisioning-template attribute map');
  assert.equal('attributes' in thingTemplate.Properties.AttributePayload, false,
    'Thing AttributePayload never uses the registry API nested attributes wrapper');
  assert.equal('hardwareId' in thingTemplate.Properties.AttributePayload, false,
    'authoritative hardware identity is not exposed as Thing metadata');
  assert.deepEqual(thingTemplate.OverrideSettings, {
    AttributePayload: 'REPLACE',
    ThingTypeName: 'REPLACE',
    ThingGroups: 'REPLACE',
  }, 'Thing overrides contain only provisioning-template-supported keys');
  assert.equal('BillingGroup' in thingTemplate.OverrideSettings, false);
  assert.deepEqual(parsedProvisioningTemplate.Resources.certificate.Properties, {
    CertificateId: { Ref: 'AWS::IoT::Certificate::Id' },
    Status: 'ACTIVE',
    ThingPrincipalType: 'EXCLUSIVE_THING',
  });
  assert.deepEqual(parsedProvisioningTemplate.Resources.policy.Properties, {
    PolicyName: 'ConnectedEnterpriseGatewayOperational-dev-v1',
  });
  assert.deepEqual(parsedProvisioningTemplate.Resources.configCredentialsPolicy.Properties, {
    PolicyName: 'ConnectedEnterpriseGatewayConfigCredentials-dev-v1',
  });

  const policies = Object.values(rendered.Resources).filter((resource) => resource.Type === 'AWS::IoT::Policy');
  const bootstrap = policies.find((resource) => resource.Properties?.PolicyName === 'ConnectedEnterpriseGatewayBootstrap-dev-v1');
  const operational = policies.find((resource) => resource.Properties?.PolicyName === 'ConnectedEnterpriseGatewayOperational-dev-v1');
  const configCredentials = policies.find((resource) =>
    resource.Properties?.PolicyName === 'ConnectedEnterpriseGatewayConfigCredentials-dev-v1');
  assert.ok(bootstrap, 'per-device bootstrap policy is synthesized for manufacturing attachment');
  assert.ok(operational, 'operational policy is synthesized');
  assert.ok(configCredentials, 'separate credential-provider policy is synthesized');
  const bootstrapJson = JSON.stringify(bootstrap);
  assert.match(bootstrapJson, /certificates\/create\/json/);
  assert.match(bootstrapJson, /create-from-csr/);
  const resolvedBootstrapPolicy = resolvePolicyIntrinsics(bootstrap.Properties?.PolicyDocument) as {
    Statement: Array<{ Action: string | string[]; Resource: string | string[]; Sid?: string }>;
  };
  const bootstrapConnect = resolvedBootstrapPolicy.Statement.find((statement) =>
    (Array.isArray(statement.Action) ? statement.Action : [statement.Action]).includes('iot:Connect'));
  assert.equal(bootstrapConnect?.Sid, 'ConnectWithRandomClaimClientId');
  assert.equal(bootstrapConnect?.Resource, 'arn:aws:iot:us-east-1:111122223333:client/claim-*');
  const bootstrapResourcesFor = (action: string) => {
    const statement = resolvedBootstrapPolicy.Statement.find((candidate) =>
      (Array.isArray(candidate.Action) ? candidate.Action : [candidate.Action]).includes(action));
    assert.ok(statement, `bootstrap ${action} statement is present`);
    return Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
  };
  assert.deepEqual(bootstrapResourcesFor('iot:Publish'), [
    'arn:aws:iot:us-east-1:111122223333:topic/$aws/certificates/create/json',
    'arn:aws:iot:us-east-1:111122223333:topic/$aws/certificates/create-from-csr/json',
    'arn:aws:iot:us-east-1:111122223333:topic/$aws/provisioning-templates/CEOnboarding-dev/provision/json',
  ]);
  assert.deepEqual(bootstrapResourcesFor('iot:Subscribe'), [
    'arn:aws:iot:us-east-1:111122223333:topicfilter/$aws/certificates/create/json/accepted',
    'arn:aws:iot:us-east-1:111122223333:topicfilter/$aws/certificates/create/json/rejected',
    'arn:aws:iot:us-east-1:111122223333:topicfilter/$aws/certificates/create-from-csr/json/accepted',
    'arn:aws:iot:us-east-1:111122223333:topicfilter/$aws/certificates/create-from-csr/json/rejected',
    'arn:aws:iot:us-east-1:111122223333:topicfilter/$aws/provisioning-templates/CEOnboarding-dev/provision/json/accepted',
    'arn:aws:iot:us-east-1:111122223333:topicfilter/$aws/provisioning-templates/CEOnboarding-dev/provision/json/rejected',
  ]);
  assert.deepEqual(bootstrapResourcesFor('iot:Receive'), [
    'arn:aws:iot:us-east-1:111122223333:topic/$aws/certificates/create/json/accepted',
    'arn:aws:iot:us-east-1:111122223333:topic/$aws/certificates/create/json/rejected',
    'arn:aws:iot:us-east-1:111122223333:topic/$aws/certificates/create-from-csr/json/accepted',
    'arn:aws:iot:us-east-1:111122223333:topic/$aws/certificates/create-from-csr/json/rejected',
    'arn:aws:iot:us-east-1:111122223333:topic/$aws/provisioning-templates/CEOnboarding-dev/provision/json/accepted',
    'arn:aws:iot:us-east-1:111122223333:topic/$aws/provisioning-templates/CEOnboarding-dev/provision/json/rejected',
  ]);
  for (const action of ['iot:Publish', 'iot:Subscribe', 'iot:Receive']) {
    assert.ok(bootstrapResourcesFor(action).every((resource) => !resource.includes('*')),
      `${action} uses only exact provisioning topics`);
  }
  template.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: 'connected-enterprise-onboarding-dev-pre-provision',
    Environment: { Variables: { BOOTSTRAP_CLIENT_ID_PREFIX: 'claim-' } },
  });
  const operationalJson = JSON.stringify(operational);
  assert.match(operationalJson, /shadow\/name\/configuration\/\*/);
  assert.doesNotMatch(operationalJson, /shadow\/name\/config\/\*/);

  const resolvedPolicy = resolvePolicyIntrinsics(operational.Properties?.PolicyDocument) as {
    Statement: Array<{ Action: string | string[]; Resource: string | string[] }>;
  };
  const serializedPolicy = JSON.stringify(resolvedPolicy);
  const serializedPolicyBytes = Buffer.byteLength(serializedPolicy, 'utf8');
  assert.ok(serializedPolicyBytes < 2_048, `operational IoT policy is ${serializedPolicyBytes} bytes; limit is <2048`);

  const statementFor = (action: string) => resolvedPolicy.Statement.find((statement) =>
    (Array.isArray(statement.Action) ? statement.Action : [statement.Action]).includes(action));
  const resourcesFor = (action: string) => {
    const resources = statementFor(action)?.Resource;
    assert.ok(resources, `${action} statement is present`);
    return Array.isArray(resources) ? resources : [resources];
  };
  const thingBinding = '${iot:Connection.Thing.ThingName}';
  for (const action of ['iot:Connect', 'iot:Publish', 'iot:Receive', 'iot:Subscribe']) {
    assert.ok(resourcesFor(action).every((resource) => resource.includes(thingBinding)), `${action} remains Thing-bound`);
  }
  assert.ok(resourcesFor('iot:Connect').every((resource) => resource.includes(`client/${thingBinding}`)));
  assert.ok(resourcesFor('iot:Publish').every((resource) => !resource.endsWith('/config/response')),
    'devices cannot publish configuration responses');
  assert.ok(resourcesFor('iot:Receive').some((resource) => resource.includes('/jobs/*')),
    'jobs remain device-isolated');
  assert.ok(resourcesFor('iot:Receive').some((resource) => resource.includes('/shadow/name/configuration/*')),
    'named configuration shadow remains device-isolated');
  assert.equal(Object.values(rendered.Resources).filter((resource) => resource.Type === 'AWS::IoT::Certificate').length, 0);

  const iamPolicies = Object.values(rendered.Resources).filter((resource) => resource.Type === 'AWS::IAM::Policy');
  const provisioningIam = iamPolicies.find((resource) => JSON.stringify(resource).includes('AttachIssuedCertificateToGatewayThing'));
  assert.ok(provisioningIam, 'Fleet provisioning role policy is present');
  const provisioningJson = JSON.stringify(provisioningIam);
  assert.match(provisioningJson, /iot:AttachThingPrincipal/);
  assert.match(provisioningJson, /iot:thingArn/);
  assert.match(provisioningJson, /:cert\/\*/);
  assert.doesNotMatch(provisioningJson, /iot:PolicyName/);

  const provisioningRole = Object.values(rendered.Resources).find((resource) =>
    resource.Type === 'AWS::IAM::Role'
    && resource.Properties?.RoleName === 'connected-enterprise-onboarding-dev-fleet-provisioning');
  assert.ok(provisioningRole?.Properties, 'Fleet Provisioning role is present');
  const managedPolicyArns = resolvePolicyIntrinsics(provisioningRole.Properties.ManagedPolicyArns) as string[];
  assert.deepEqual(managedPolicyArns, [
    'arn:aws:iam::aws:policy/service-role/AWSIoTThingsRegistration',
  ], 'dev-only simulator role uses the AWS-supported Things registration policy');
  const trustJson = JSON.stringify(resolvePolicyIntrinsics(provisioningRole.Properties.AssumeRolePolicyDocument));
  assert.match(trustJson, /iot\.amazonaws\.com/);
  assert.match(trustJson, /aws:SourceAccount/);
  assert.match(trustJson, /111122223333/);
  assert.match(trustJson, /aws:SourceArn/);
  assert.match(trustJson, /provisioningtemplate\/CEOnboarding-dev/);

  const provisioningStatements = (provisioningIam.Properties?.PolicyDocument as {
    Statement: Array<{
      Sid?: string;
      Action: string | string[];
      Resource: unknown | unknown[];
      Condition?: unknown;
    }>;
  }).Statement;
  const actionsFor = (statement: (typeof provisioningStatements)[number]) =>
    Array.isArray(statement.Action) ? statement.Action : [statement.Action];
  const resourcesForStatement = (statement: (typeof provisioningStatements)[number]) =>
    Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
  const exactStatementFor = (action: string) => {
    const matches = provisioningStatements.filter((statement) => actionsFor(statement).includes(action));
    assert.equal(matches.length, 1, `Fleet Provisioning has exactly one ${action} statement`);
    const statement = matches[0];
    assert.ok(statement, `${action} statement is present`);
    assert.deepEqual(actionsFor(statement), [action], `${action} is not mixed with other IoT actions`);
    return statement;
  };
  const registerThingStatement = exactStatementFor('iot:RegisterThing');

  assert.deepEqual(actionsFor(registerThingStatement), ['iot:RegisterThing'],
    'RegisterThing is not mixed with subordinate IoT actions');
  assert.deepEqual(resourcesForStatement(registerThingStatement), ['*'],
    'RegisterThing uses the service-required wildcard resource');
  assert.equal(registerThingStatement.Condition, undefined,
    'RegisterThing is not constrained by unsupported resource conditions');

  const resolvedProvisioningResources = (statement: (typeof provisioningStatements)[number]) =>
    resourcesForStatement(statement).map((resource) => resolvePolicyIntrinsics(resource));
  assert.deepEqual(resolvedProvisioningResources(exactStatementFor('iot:DescribeThingGroup')), [
    'arn:aws:iot:us-east-1:111122223333:thinggroup/connected-enterprise-gateways-dev',
  ], 'DescribeThingGroup is scoped to the exact Fleet Provisioning group');
  assert.deepEqual(resolvedProvisioningResources(exactStatementFor('iot:DescribeThingType')), [
    'arn:aws:iot:us-east-1:111122223333:thingtype/ConnectedEnterpriseGateway-dev',
  ], 'DescribeThingType is scoped to the exact Fleet Provisioning type');
  assert.deepEqual(resolvedProvisioningResources(exactStatementFor('iot:ListThingGroupsForThing')), [
    'arn:aws:iot:us-east-1:111122223333:thing/gw-*',
  ], 'ListThingGroupsForThing is scoped to managed gateway Things');
  assert.deepEqual(resolvedProvisioningResources(exactStatementFor('iot:ListThingPrincipals')), [
    'arn:aws:iot:us-east-1:111122223333:thing/gw-*',
  ], 'ListThingPrincipals is scoped to managed gateway Things');
  assert.deepEqual(resolvedProvisioningResources(exactStatementFor('iot:ListPrincipalThings')), [
    'arn:aws:iot:us-east-1:111122223333:cert/*',
  ], 'ListPrincipalThings is scoped to issued certificates');
  assert.deepEqual(resolvedProvisioningResources(exactStatementFor('iot:ListAttachedPolicies')), [
    'arn:aws:iot:us-east-1:111122223333:cert/*',
  ], 'ListAttachedPolicies is scoped to issued certificates');

  for (const statement of provisioningStatements) {
    if (statement === registerThingStatement) continue;
    assert.ok(resourcesForStatement(statement).every((resource) => resource !== '*'),
      `${actionsFor(statement).join(', ')} remains resource-scoped`);
  }
});

test('pre-provisioning validates the client ID against its configured prefix', () => {
  const preHook = fs.readFileSync(path.join(process.cwd(), 'lambda', 'pre-provision-hook.ts'), 'utf8');
  assert.match(preHook, /process\.env\.BOOTSTRAP_CLIENT_ID_PREFIX/);
  assert.match(preHook, /clientId\.startsWith\(BOOTSTRAP_CLIENT_ID_PREFIX\)/);
  assert.doesNotMatch(preHook, /clientId\.startsWith\(['"](?:bootstrap|claim)-/);
});

test('preloaded unique bootstrap onboarding retains exact certificate, tenant, and state fences', () => {
  const api = fs.readFileSync(path.join(process.cwd(), 'lambda', 'api-handler.ts'), 'utf8');
  const preHook = fs.readFileSync(path.join(process.cwd(), 'lambda', 'pre-provision-hook.ts'), 'utf8');
  const config = fs.readFileSync(path.join(process.cwd(), 'lambda', 'iot-config-handler.ts'), 'utf8');
  const outbox = fs.readFileSync(path.join(process.cwd(), 'lambda', 'outbox-handler.ts'), 'utf8');
  const ddb = fs.readFileSync(path.join(process.cwd(), 'lambda', 'shared', 'ddb.ts'), 'utf8');

  assert.match(api, /requireRole\(context, 'platform_admin', 'tenant_admin', 'operator'\)/);
  assert.match(api, /canonicalJson\(\{ route: event\.routeKey, serialNumber \}\)/);
  assert.match(api, /tenantAuthorized/);
  assert.match(api, /#state = :reserved/);
  assert.match(api, /PRELOADED_UNIQUE_BOOTSTRAP/);
  assert.match(api, /bootstrapCertificateId = :bootstrapCertificateId/);
  assert.match(api, /bootstrapCertificateStatus = :bootstrapCertificateActive/);
  assert.match(api, /verificationExpiresAtEpoch < :nowEpoch/);
  assert.match(api, /verificationExpiresAtEpoch >= :nowEpoch/);
  assert.match(api, /enrollmentAuthorizedAt = :now/);
  assert.match(api, /REMOVE verificationExpiresAtEpoch/);
  assert.doesNotMatch(api, /body\.activationCode|validatedActivationCode|hardwareProofDigest|safeDigestEqual/);

  assert.match(preHook, /event\.templateArn !== EXPECTED_TEMPLATE_ARN/);
  assert.match(preHook, /record\.bootstrapCertificateId !== claimCertificateId/);
  assert.match(preHook, /PRELOADED_UNIQUE_BOOTSTRAP/);
  assert.match(preHook, /bootstrapCertificateStatus !== 'ACTIVE'/);
  assert.match(preHook, /bootstrapCertificatePk\(claimCertificateId\)/);
  assert.match(preHook, /BOOTSTRAP_CERTIFICATE_BINDING/);
  assert.match(preHook, /enrollmentAuthorizedAt = :enrollmentAuthorizedAt/);
  assert.match(preHook, /ENROLLMENT_PENDING/);
  assert.match(preHook, /deploymentSk\(record\.gatewayId, 1\)/);
  assert.doesNotMatch(preHook, /verificationExpiresAtEpoch|VERIFICATION#|verification expired/);
  assert.doesNotMatch(preHook, /HardwareId|HardwareProof|hardwareId|hardwareProof|requireHardwareId/);
  for (const source of [api, preHook, config, outbox]) {
    assert.doesNotMatch(source, /TRUSTED_USER_FIVE_MINUTE|trustedClaimExpiresAtEpoch|trustedClaimIssuedAt|CreateProvisioningClaimCommand/);
  }
  assert.match(config, /eventType: 'DEACTIVATE_BOOTSTRAP_CERTIFICATE'/);
  assert.match(config, /bootstrapCertificateStatus = :bootstrapDeactivating/);
  assert.match(config, /Key: bootstrapBindingKey/);
  assert.match(config, /#status = :deactivating/);
  assert.match(outbox, /newStatus: 'INACTIVE'/);
  assert.match(outbox, /BOOTSTRAP_CERTIFICATE_DEACTIVATED/);
  assert.match(outbox, /bootstrapCertificatePk\(bootstrapCertificateId\)/);
  assert.match(outbox, /#status = :inactive/);
  assert.match(outbox, /FAILED_RETRYABLE/);
  assert.match(ddb, /BOOTSTRAPCERT#/);

  const rendered = synthesized().toJSON() as {
    Resources: Record<string, { Type: string; Properties?: Record<string, unknown> }>;
  };
  for (const functionName of [
    'connected-enterprise-onboarding-dev-api',
    'connected-enterprise-onboarding-dev-pre-provision',
  ]) {
    const lambdaFunction = Object.values(rendered.Resources).find((resource) =>
      resource.Type === 'AWS::Lambda::Function' && resource.Properties?.FunctionName === functionName);
    assert.ok(lambdaFunction?.Properties, `${functionName} is synthesized`);
    const environment = lambdaFunction.Properties.Environment as { Variables?: Record<string, unknown> } | undefined;
    assert.equal('HARDWARE_PROOF_SECRET_ARN' in (environment?.Variables ?? {}), false,
      `${functionName} has no hardware-proof secret access`);
  }
});

test('IoT Rules inject broker identity and route failures to a queue', () => {
  const template = synthesized();
  template.hasResourceProperties('AWS::IoT::TopicRule', {
    TopicRulePayload: {
      Sql: Match.stringLikeRegexp("principal\\(\\).*clientid\\(\\).*ce/v1/gateways/\\+/config/request"),
      ErrorAction: { Sqs: Match.anyValue() },
      Actions: [{ Lambda: { FunctionArn: Match.anyValue() } }],
    },
  });
  template.hasResourceProperties('AWS::IoT::TopicRule', {
    TopicRulePayload: {
      Sql: Match.stringLikeRegexp("principal\\(\\).*clientid\\(\\).*ce/v1/gateways/\\+/status"),
      ErrorAction: { Sqs: Match.anyValue() },
    },
  });
  const renderedTemplate = template.toJSON() as {
    Resources: Record<string, { Type: string; Properties?: { TopicRulePayload?: { Sql?: string } } }>;
  };
  const ruleSql = Object.values(renderedTemplate.Resources)
    .filter((resource) => resource.Type === 'AWS::IoT::TopicRule')
    .map((resource) => resource.Properties?.TopicRulePayload?.Sql)
    .filter((sql): sql is string => typeof sql === 'string');
  assert.equal(ruleSql.length, 2);
  assert.deepEqual(new Set(ruleSql), new Set([
    "SELECT generation, requestId, principal() AS brokerPrincipal, clientid() AS brokerClientId, topic() AS brokerTopic, traceid() AS brokerTraceId, timestamp() AS brokerReceivedAt FROM 'ce/v1/gateways/+/config/request'",
    "SELECT generation, status, profileVersionId, profileChecksum, detail, error, principal() AS brokerPrincipal, clientid() AS brokerClientId, topic() AS brokerTopic, traceid() AS brokerTraceId, timestamp() AS brokerReceivedAt FROM 'ce/v1/gateways/+/status'",
  ]));
  const expectedAliases = ['brokerPrincipal', 'brokerClientId', 'brokerTopic', 'brokerTraceId', 'brokerReceivedAt'];
  for (const sql of ruleSql) {
    const selectClause = /^SELECT (.+) FROM /i.exec(sql)?.[1];
    assert.ok(selectClause, 'IoT rule has an explicit SELECT clause');
    const selections = selectClause.split(',').map((entry) => entry.trim());
    const aliases = selections.flatMap((entry) => {
      const match = /\s+AS\s+(\S+)$/i.exec(entry);
      return match?.[1] ? [match[1]] : [];
    });
    assert.deepEqual(aliases, expectedAliases);
    assert.ok(aliases.every((alias) => /^[A-Za-z][A-Za-z0-9_]*$/.test(alias)),
      'broker aliases use AWS IoT SQL identifiers that begin with a letter');
    const payloadFields = selections.filter((entry) => !/\s+AS\s+/i.test(entry));
    const expectedPayloadFields = sql.endsWith("FROM 'ce/v1/gateways/+/config/request'")
      ? ['generation', 'requestId']
      : ['generation', 'status', 'profileVersionId', 'profileChecksum', 'detail', 'error'];
    assert.deepEqual(payloadFields, expectedPayloadFields);
    assert.ok(aliases.every((alias) => !payloadFields.includes(alias)), 'payload fields cannot collide with broker aliases');
  }
  const rendered = JSON.stringify(renderedTemplate);
  assert.doesNotMatch(rendered, /SELECT \*/);
  assert.doesNotMatch(rendered, /\bAS\s+_/i);
});

test('IoT handlers fail closed on broker alias collisions and identity mismatch', async () => {
  process.env.TABLE_NAME ??= 'connected-enterprise-onboarding-unit-test';
  process.env.IOT_DATA_ENDPOINT ??= 'example-ats.iot.us-east-1.amazonaws.com';
  const [{ configBrokerIdentity }, { statusBrokerIdentity }] = await Promise.all([
    import('../lambda/iot-config-handler.js'),
    import('../lambda/iot-status-handler.js'),
  ]);
  const trusted = {
    brokerPrincipal: 'certificate-id-123',
    brokerClientId: 'gw-device-123',
    brokerTopic: 'ce/v1/gateways/gw-device-123/config/request',
    brokerTraceId: 'trace-123',
    brokerReceivedAt: 1_700_000_000_000,
    // These payload/legacy names are attacker-controlled and must never be
    // consulted in place of the explicitly selected broker aliases.
    principal: 'attacker-certificate',
    clientId: 'gw-attacker',
    topic: 'ce/v1/gateways/gw-attacker/config/request',
    thingName: 'gw-attacker',
    gatewayId: 'gateway-attacker',
    certificateId: 'attacker-certificate',
    _brokerPrincipal: 'legacy-attacker-certificate',
  };
  assert.deepEqual(configBrokerIdentity(trusted), {
    brokerPrincipal: 'certificate-id-123',
    brokerClientId: 'gw-device-123',
    brokerTopic: 'ce/v1/gateways/gw-device-123/config/request',
    thingName: 'gw-device-123',
  });
  assert.throws(() => configBrokerIdentity({ ...trusted, brokerPrincipal: undefined }), /brokerPrincipal/);
  assert.throws(() => configBrokerIdentity({
    _brokerPrincipal: 'certificate-id-123',
    _brokerClientId: 'gw-device-123',
    _brokerTopic: 'ce/v1/gateways/gw-device-123/config/request',
  }), /brokerTopic/);
  assert.throws(() => configBrokerIdentity({ ...trusted, brokerClientId: 'gw-attacker' }), /does not match/);
  assert.throws(() => configBrokerIdentity({
    ...trusted,
    brokerTopic: 'ce/v1/gateways/gw-attacker/config/request',
  }), /does not match/);

  const statusEvent = { ...trusted, brokerTopic: 'ce/v1/gateways/gw-device-123/status' };
  assert.equal(statusBrokerIdentity(statusEvent).thingName, 'gw-device-123');
  assert.throws(() => statusBrokerIdentity({ ...statusEvent, brokerClientId: 'gw-attacker' }), /does not match/);
  assert.throws(() => statusBrokerIdentity({ ...statusEvent, brokerTopic: 'invalid/status' }), /authoritative/);
  assert.throws(() => statusBrokerIdentity({
    ...statusEvent,
    brokerTopic: 'ce/v1/gateways/gw-device-123/extra/status',
  }), /invalid thing name/);

  for (const filename of ['iot-config-handler.ts', 'iot-status-handler.ts']) {
    const source = fs.readFileSync(path.join(process.cwd(), 'lambda', filename), 'utf8');
    assert.match(source, /certificateId !== brokerPrincipal/);
    assert.doesNotMatch(source, /event\._broker/);
  }
});

test('async IoT handler failures have encrypted destinations and alarms', () => {
  const template = synthesized();
  template.resourceCountIs('AWS::Lambda::EventInvokeConfig', 2);
  template.hasResourceProperties('AWS::Lambda::EventInvokeConfig', {
    MaximumEventAgeInSeconds: 300,
    MaximumRetryAttempts: 2,
    DestinationConfig: { OnFailure: { Destination: Match.anyValue() } },
  });
  for (const suffix of ['iot-config-async-dlq', 'iot-status-async-dlq']) {
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: `connected-enterprise-onboarding-dev-${suffix}`,
      KmsMasterKeyId: Match.anyValue(),
      MessageRetentionPeriod: 1_209_600,
    });
    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: `connected-enterprise-onboarding-dev-${suffix}`,
      Threshold: 1,
    });
  }
});

test('HTTP handler exposes the exact Connected Enterprise onboarding contract', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'lambda', 'api-handler.ts'), 'utf8');
  const authSource = fs.readFileSync(path.join(process.cwd(), 'lambda', 'shared', 'auth.ts'), 'utf8');
  for (const route of [
    'GET /api/onboarding/snapshot',
    'POST /api/onboarding/claims/verify',
    'POST /api/onboarding/profiles',
    'POST /api/onboarding/operations',
    'GET /api/onboarding/operations/{operationId}',
    'POST /api/onboarding/gateways/{gatewayId}/decommission',
    'POST /api/onboarding/gateways/{gatewayId}/assignments',
  ]) assert.match(source, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(source, /tenantContext\(event\)/);
  assert.doesNotMatch(source, /body\.tenantId/);
  assert.match(authSource, /claims\.token_use !== 'access'/);
});

test('HTTP API declares exact JWT routes so Lambda receives exact routeKey values', () => {
  const template = synthesized();
  for (const routeKey of [
    'GET /api/onboarding/snapshot',
    'POST /api/onboarding/claims/verify',
    'POST /api/onboarding/profiles',
    'POST /api/onboarding/operations',
    'GET /api/onboarding/operations/{operationId}',
    'POST /api/onboarding/gateways/{gatewayId}/decommission',
    'POST /api/onboarding/gateways/{gatewayId}/assignments',
    'GET /profiles',
    'POST /profiles',
    'POST /profiles/{profileId}/versions',
    'POST /gateways/{gatewayId}/assignments',
  ]) {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: routeKey, AuthorizationType: 'JWT' });
  }
  const rendered = JSON.stringify(template.toJSON());
  assert.doesNotMatch(rendered, /ANY \/\{proxy\+\}/);
});

test('public gateway HTTP probe is isolated, throttled, and is the only unauthenticated route', () => {
  const template = synthesized();
  template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
    RouteKey: 'GET /device/v1/test/ping',
    AuthorizationType: 'NONE',
  });
  template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
    RouteSettings: {
      'GET /device/v1/test/ping': {
        ThrottlingBurstLimit: 5,
        ThrottlingRateLimit: 2,
      },
    },
  });
  template.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: 'connected-enterprise-onboarding-dev-public-device-test',
    ReservedConcurrentExecutions: 5,
    Timeout: 3,
  });

  const rendered = template.toJSON() as {
    Resources: Record<string, { Type: string; Properties?: Record<string, unknown>; DependsOn?: string | string[] }>;
  };
  const routes = Object.values(rendered.Resources)
    .filter((resource) => resource.Type === 'AWS::ApiGatewayV2::Route')
    .map((resource) => resource.Properties ?? {});
  const publicRoutes = routes.filter((route) => route.AuthorizationType === 'NONE');
  assert.deepEqual(publicRoutes.map((route) => route.RouteKey), ['GET /device/v1/test/ping']);
  const publicRouteEntry = Object.entries(rendered.Resources).find(([, resource]) =>
    resource.Type === 'AWS::ApiGatewayV2::Route'
    && resource.Properties?.RouteKey === 'GET /device/v1/test/ping');
  assert.ok(publicRouteEntry, 'public probe route is synthesized');
  const defaultStage = Object.values(rendered.Resources).find((resource) =>
    resource.Type === 'AWS::ApiGatewayV2::Stage');
  assert.ok(defaultStage, 'HTTP API default stage is synthesized');
  const stageDependencies = Array.isArray(defaultStage.DependsOn)
    ? defaultStage.DependsOn
    : [defaultStage.DependsOn].filter((value): value is string => typeof value === 'string');
  assert.ok(stageDependencies.includes(publicRouteEntry[0]),
    'stage route throttling waits until the public route exists');

  const publicFunction = Object.values(rendered.Resources).find((resource) =>
    resource.Type === 'AWS::Lambda::Function'
    && resource.Properties?.FunctionName === 'connected-enterprise-onboarding-dev-public-device-test');
  assert.ok(publicFunction, 'dedicated public probe Lambda is synthesized');
  const roleLogicalId = (publicFunction.Properties?.Role as { 'Fn::GetAtt': [string, string] })['Fn::GetAtt'][0];
  const publicRole = rendered.Resources[roleLogicalId];
  if (!publicRole) assert.fail('public probe execution role is synthesized');
  assert.equal(publicRole.Type, 'AWS::IAM::Role');
  assert.equal(publicRole.Properties?.Policies, undefined, 'public probe receives no inline data-access policy');
  assert.equal(JSON.stringify(publicRole.Properties?.ManagedPolicyArns ?? []).includes('AWSLambdaBasicExecutionRole'), true);
  assert.deepEqual(publicFunction.Properties?.Environment, { Variables: { STAGE: 'dev' } });
  const publicRolePolicies = Object.values(rendered.Resources).filter((resource) =>
    resource.Type === 'AWS::IAM::Policy'
    && JSON.stringify(resource.Properties?.Roles ?? []).includes(`\"Ref\":\"${roleLogicalId}\"`));
  const publicPermissions = JSON.stringify(publicRolePolicies);
  assert.doesNotMatch(publicPermissions, /dynamodb:|s3:|secretsmanager:|kms:(?:Decrypt|Sign)/i,
    'public probe cannot read control-plane data, secrets, artifacts, or signing keys');
});

test('fleet configuration pull and status acknowledgement use one exact IoT credential role and AWS_IAM routes', () => {
  const template = synthesized();
  template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
    RouteKey: 'GET /device/v1/things/{thingName}/certificates/{certificateId}/configuration',
    AuthorizationType: 'AWS_IAM',
  });
  template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
    RouteKey: 'POST /device/v1/things/{thingName}/certificates/{certificateId}/status',
    AuthorizationType: 'AWS_IAM',
  });
  template.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: 'connected-enterprise-onboarding-dev-device-config-http',
    ReservedConcurrentExecutions: 50,
    Timeout: 10,
    Environment: {
      Variables: Match.objectLike({
        GATEWAY_CONFIG_ROLE_NAME: 'connected-enterprise-onboarding-dev-gateway-config-pull',
      }),
    },
  });
  template.hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: 'connected-enterprise-onboarding-dev-device-status-http',
    ReservedConcurrentExecutions: 50,
    Timeout: 10,
    Environment: {
      Variables: Match.objectLike({
        TABLE_NAME: Match.anyValue(),
        AWS_ACCOUNT_ID: Match.anyValue(),
        GATEWAY_CONFIG_ROLE_NAME: 'connected-enterprise-onboarding-dev-gateway-config-pull',
        STAGE: 'dev',
      }),
    },
  });
  template.hasResourceProperties('AWS::Logs::LogGroup', {
    LogGroupName: '/aws/lambda/connected-enterprise-onboarding-dev-device-status-http',
    RetentionInDays: 90,
    KmsKeyId: Match.anyValue(),
  });
  template.hasResourceProperties('AWS::IoT::RoleAlias', {
    RoleAlias: 'GatewayConfigPull-dev',
    CredentialDurationSeconds: 3600,
  });
  template.hasOutput('DeviceConfigurationUrlTemplate', {});
  template.hasOutput('DeviceStatusUrlTemplate', {});
  template.hasOutput('IotCredentialProviderEndpoint', {});
  template.hasOutput('GatewayConfigRoleAliasName', {});
  template.hasOutput('GatewayConfigCredentialsPolicyName', {});

  const rendered = template.toJSON() as {
    Resources: Record<string, { Type: string; Properties?: Record<string, unknown>; DependsOn?: string | string[] }>;
  };
  const configRouteEntry = Object.entries(rendered.Resources).find(([, resource]) =>
    resource.Type === 'AWS::ApiGatewayV2::Route'
    && resource.Properties?.RouteKey === 'GET /device/v1/things/{thingName}/certificates/{certificateId}/configuration');
  assert.ok(configRouteEntry, 'secured configuration route is synthesized');
  const statusRouteEntry = Object.entries(rendered.Resources).find(([, resource]) =>
    resource.Type === 'AWS::ApiGatewayV2::Route'
    && resource.Properties?.RouteKey === 'POST /device/v1/things/{thingName}/certificates/{certificateId}/status');
  assert.ok(statusRouteEntry, 'secured configuration status route is synthesized');
  const stage = Object.values(rendered.Resources).find((resource) => resource.Type === 'AWS::ApiGatewayV2::Stage');
  assert.ok(stage?.Properties, 'default stage is synthesized');
  const stageDependencies = Array.isArray(stage.DependsOn)
    ? stage.DependsOn
    : [stage.DependsOn].filter((value): value is string => typeof value === 'string');
  assert.ok(stageDependencies.includes(configRouteEntry[0]), 'stage waits for secured route before applying throttling');
  assert.ok(stageDependencies.includes(statusRouteEntry[0]), 'stage waits for secured status route before applying throttling');
  assert.deepEqual((stage.Properties.RouteSettings as Record<string, unknown>)[configRouteEntry[1].Properties?.RouteKey as string], {
    ThrottlingBurstLimit: 100,
    ThrottlingRateLimit: 50,
  });
  assert.deepEqual((stage.Properties.RouteSettings as Record<string, unknown>)[statusRouteEntry[1].Properties?.RouteKey as string], {
    ThrottlingBurstLimit: 100,
    ThrottlingRateLimit: 50,
  });

  const configFunctionEntry = Object.entries(rendered.Resources).find(([, resource]) =>
    resource.Type === 'AWS::Lambda::Function'
    && resource.Properties?.FunctionName === 'connected-enterprise-onboarding-dev-device-config-http');
  assert.ok(configFunctionEntry, 'dedicated configuration Lambda is synthesized');
  const configRoleLogicalId = (configFunctionEntry[1].Properties?.Role as { 'Fn::GetAtt': [string, string] })['Fn::GetAtt'][0];
  const configRolePolicies = Object.values(rendered.Resources).filter((resource) =>
    resource.Type === 'AWS::IAM::Policy'
    && JSON.stringify(resource.Properties?.Roles ?? []).includes(`\"Ref\":\"${configRoleLogicalId}\"`));
  const configPermissions = JSON.stringify(configRolePolicies);
  assert.match(configPermissions, /dynamodb:GetItem/);
  assert.match(configPermissions, /dynamodb:Query/);
  assert.match(configPermissions, /dynamodb:PutItem/);
  assert.match(configPermissions, /dynamodb:UpdateItem/);
  assert.doesNotMatch(configPermissions, /dynamodb:TransactWriteItems/);
  assert.match(configPermissions, /index\/GSI1/);
  assert.match(configPermissions, /kms:Decrypt/);
  assert.match(configPermissions, /kms:DescribeKey/);
  assert.match(configPermissions, /kms:Encrypt/);
  assert.match(configPermissions, /kms:GenerateDataKey\*/);
  assert.match(configPermissions, /kms:ReEncrypt\*/);
  assert.doesNotMatch(configPermissions, /kms:Sign|secretsmanager:|iot:/i);

  const statusFunctionEntry = Object.entries(rendered.Resources).find(([, resource]) =>
    resource.Type === 'AWS::Lambda::Function'
    && resource.Properties?.FunctionName === 'connected-enterprise-onboarding-dev-device-status-http');
  assert.ok(statusFunctionEntry, 'dedicated configuration status Lambda is synthesized');
  const statusRoleLogicalId = (statusFunctionEntry[1].Properties?.Role as { 'Fn::GetAtt': [string, string] })['Fn::GetAtt'][0];
  const statusRolePolicies = Object.values(rendered.Resources).filter((resource) =>
    resource.Type === 'AWS::IAM::Policy'
    && JSON.stringify(resource.Properties?.Roles ?? []).includes(`\"Ref\":\"${statusRoleLogicalId}\"`));
  const statusPermissions = JSON.stringify(statusRolePolicies);
  assert.match(statusPermissions, /dynamodb:GetItem/);
  assert.match(statusPermissions, /dynamodb:Query/);
  assert.match(statusPermissions, /dynamodb:PutItem/);
  assert.match(statusPermissions, /dynamodb:UpdateItem/);
  assert.doesNotMatch(statusPermissions, /dynamodb:TransactWriteItems/);
  assert.match(statusPermissions, /index\/GSI1/);
  assert.match(statusPermissions, /kms:Decrypt/);
  assert.match(statusPermissions, /kms:DescribeKey/);
  assert.match(statusPermissions, /kms:Encrypt/);
  assert.match(statusPermissions, /kms:GenerateDataKey\*/);
  assert.match(statusPermissions, /kms:ReEncrypt\*/);
  assert.doesNotMatch(statusPermissions, /s3:|secretsmanager:|kms:Sign|iot:/i,
    'status acknowledgement Lambda cannot read profile artifacts, secrets, signing keys, or IoT resources');

  const roleEntry = Object.entries(rendered.Resources).find(([, resource]) =>
    resource.Type === 'AWS::IAM::Role'
    && resource.Properties?.RoleName === 'connected-enterprise-onboarding-dev-gateway-config-pull');
  assert.ok(roleEntry, 'shared gateway configuration role is synthesized');
  const roleTrust = JSON.stringify(resolvePolicyIntrinsics(roleEntry[1].Properties?.AssumeRolePolicyDocument));
  assert.match(roleTrust, /credentials\.iot\.amazonaws\.com/);
  assert.match(roleTrust, /aws:SourceAccount/);
  assert.match(roleTrust, /111122223333/);
  assert.match(roleTrust, /aws:SourceArn/);
  assert.match(roleTrust, /rolealias\/GatewayConfigPull-dev/);

  const rolePolicies = Object.values(rendered.Resources).filter((resource) =>
    resource.Type === 'AWS::IAM::Policy'
    && JSON.stringify(resource.Properties?.Roles ?? []).includes(`\"Ref\":\"${roleEntry[0]}\"`));
  assert.equal(rolePolicies.length, 1, 'gateway role has one least-privilege policy');
  const invokePolicy = JSON.stringify(rolePolicies[0]);
  assert.match(invokePolicy, /execute-api:Invoke/);
  assert.match(invokePolicy, /\$default\/GET\/device\/v1\/things/);
  assert.match(invokePolicy, /\$default\/POST\/device\/v1\/things/);
  assert.match(invokePolicy, /certificates.*\/status/);
  assert.match(invokePolicy, /\$\{credentials-iot:ThingName\}/);
  assert.match(invokePolicy, /\$\{credentials-iot:AwsCertificateId\}/);
  assert.doesNotMatch(invokePolicy, /dynamodb:|s3:|iot:Publish|secretsmanager:/i);

  const configPolicy = Object.values(rendered.Resources).find((resource) =>
    resource.Type === 'AWS::IoT::Policy'
    && resource.Properties?.PolicyName === 'ConnectedEnterpriseGatewayConfigCredentials-dev-v1');
  assert.ok(configPolicy?.Properties, 'config credential IoT policy is synthesized');
  const resolvedConfigPolicy = resolvePolicyIntrinsics(configPolicy.Properties.PolicyDocument) as {
    Statement: Array<{ Action: string; Effect: string; Resource: string }>;
  };
  assert.deepEqual(resolvedConfigPolicy.Statement, [{
    Sid: 'AssumeOnlyGatewayConfigPullRole',
    Effect: 'Allow',
    Action: 'iot:AssumeRoleWithCertificate',
    Resource: 'arn:aws:iot:us-east-1:111122223333:rolealias/GatewayConfigPull-dev',
  }]);

  const customResources = Object.values(rendered.Resources)
    .filter((resource) => resource.Type === 'Custom::AWS')
    .map((resource) => JSON.stringify(resource.Properties));
  assert.ok(customResources.some((resource) => resource.includes('iot:CredentialProvider')),
    'credential-provider endpoint is looked up at deployment');
});

test('HTTP API renders drift-stable CORS and access-log properties', () => {
  const template = synthesized();
  template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
    CorsConfiguration: {
      AllowHeaders: ['authorization', 'content-type', 'idempotency-key'],
    },
  });

  const rendered = template.toJSON() as {
    Resources: Record<string, { Type: string; Properties?: Record<string, unknown> }>;
  };
  const stage = Object.values(rendered.Resources).find(
    (resource) => resource.Type === 'AWS::ApiGatewayV2::Stage',
  );
  assert.ok(stage?.Properties, 'HTTP API default stage is synthesized');
  const accessLogSettings = stage.Properties.AccessLogSettings as { DestinationArn?: unknown } | undefined;
  const destination = JSON.stringify(accessLogSettings?.DestinationArn);
  assert.match(destination, /:log-group:/);
  assert.match(destination, /"Ref":"ApiAccessLogGroup/);
  assert.doesNotMatch(destination, /Fn::GetAtt.*Arn/, 'base log-group ARN is explicit rather than the wildcard LogGroup Arn');
});

test('URL context rejects insecure non-local callback origins', () => {
  assert.deepEqual(requireUrlList(undefined, 'callbacks', ['http://localhost:5174/onboarding']), ['http://localhost:5174/onboarding']);
  assert.throws(() => requireUrlList(['http://example.com/callback'], 'callbacks', []), /HTTPS/);
  assert.deepEqual(requireUrlList(['https://console.example.com/onboarding'], 'callbacks', []), ['https://console.example.com/onboarding']);
  assert.deepEqual(
    requireUrlList('["https://console.example.com/onboarding"]', 'callbacks', []),
    ['https://console.example.com/onboarding'],
  );
  assert.throws(() => requireUrlList('not-json', 'callbacks', []), /JSON array/);
});

test('UI profile schema enforces operational boundaries and secret references', () => {
  assert.deepEqual(validateUiProfileParameters({
    serviceOffering: 'ANIRA', lanIpAddress: '10.20.30.1', lanPrefixLength: 24,
    wanMtu: 1500, timezone: 'America/Chicago', vpnCredentialRef: 'secretsmanager://vpn/branch',
    rollbackOnManagementLoss: true,
  }), {
    serviceOffering: 'ANIRA', lanIpAddress: '10.20.30.1', lanPrefixLength: 24,
    wanMtu: 1500, timezone: 'America/Chicago', vpnCredentialRef: 'secretsmanager://vpn/branch',
    rollbackOnManagementLoss: true,
  });
  assert.throws(() => validateUiProfileParameters({ serviceOffering: 'ROOT_SHELL' }), /must be one of/);
  assert.throws(() => validateUiProfileParameters({ lanIpAddress: '999.1.1.1' }), /IPv4/);
  assert.throws(() => validateUiProfileParameters({ wanMtu: 575 }), /between 576 and 9216/);
  assert.throws(() => validateUiProfileParameters({ timezone: '../etc/passwd' }), /invalid format/);
  assert.throws(() => validateUiProfileParameters({ vpnCredentialRef: 'plaintext-secret' }), /Secrets Manager/);
});

test('gateway profile rejects a plaintext nested wifi radio secretRef', async () => {
  process.env.TABLE_NAME ??= 'connected-enterprise-onboarding-unit-test';
  const { validateProfile } = await import('../lambda/shared/profile.js');
  const document = {
    schemaVersion: '1.0',
    network: {
      lan: { address: '10.20.30.1', prefixLength: 24 },
      wan: { mode: 'dhcp' },
    },
    wifi: {
      radios: [{ id: 'radio-1', band: '5ghz', enabled: true, secretRef: 'plaintext-secret' }],
    },
    management: { telemetryEnabled: true, loggingLevel: 'info' },
  };
  assert.throws(() => validateProfile(document), /AWS Secrets Manager.*raw secret values/i);

  const unsupportedRadioProperty = structuredClone(document);
  unsupportedRadioProperty.wifi.radios[0]!.secretRef = 'secretsmanager://tenant-demo/wifi/radio-1';
  assert.throws(() => validateProfile(unsupportedRadioProperty), /additional properties/i);

  const approvedProfile = structuredClone(document);
  delete (approvedProfile.wifi.radios[0] as { secretRef?: string }).secretRef;
  Object.assign(approvedProfile.wifi, {
    ssids: [{
      name: 'ConnectedEnterprise',
      security: 'wpa3-personal',
      secretRef: 'secretsmanager://tenant-demo/wifi/corporate',
    }],
  });
  assert.doesNotThrow(() => validateProfile(approvedProfile));
});

test('server-side profile compatibility rejects a cross-model assignment', () => {
  assert.doesNotThrow(() => assertProfileCompatibility('edge-pro', 'edge-pro'));
  assert.throws(() => assertProfileCompatibility('edge-pro', 'edge-compact'), /not compatible/);
});

test('immutable profile lineage rejects a model change', () => {
  assert.doesNotThrow(() => assertProfileLineageModel('edge-pro', 'edge-pro'));
  assert.throws(() => assertProfileLineageModel('edge-pro', 'edge-compact'), /cannot change gateway model/);
});

test('manufacturing serials share exact runtime/import boundaries', () => {
  assert.equal(requireCanonicalSerial('CE-GW-840021'), 'CE-GW-840021');
  assert.throws(() => requireCanonicalSerial(' ce-gw-840021 '), /canonical uppercase/);
  assert.throws(() => requireCanonicalSerial('CE+GW+840021'), /invalid/);
  assert.throws(() => assertUniqueCanonicalSerials(['CE-GW-840021', 'CE-GW-840021']), /unique/);
});

test('pre-token tenant selection fails closed on ambiguity and unsafe identifiers', async () => {
  process.env.TABLE_NAME ??= 'connected-enterprise-onboarding-unit-test';
  const { selectTokenMembership } = await import('../lambda/pre-token-generation.js');
  const sole = { tenantId: 'tenant-a', role: 'operator', status: 'ACTIVE' };
  assert.equal(selectTokenMembership([sole]).tenantId, 'tenant-a');
  assert.equal(selectTokenMembership([
    { ...sole, tenantId: 'tenant-a', isDefault: false },
    { ...sole, tenantId: 'tenant-b', isDefault: true },
  ]).tenantId, 'tenant-b');
  assert.throws(() => selectTokenMembership([
    { ...sole, tenantId: 'tenant-a', isDefault: true },
    { ...sole, tenantId: 'tenant-b', isDefault: true },
  ]), /unique active tenant/);
  assert.throws(() => selectTokenMembership([{ ...sole, tenantId: '../tenant-b' }]), /unique active tenant/);
  const bootstrap = fs.readFileSync(path.join(process.cwd(), 'scripts', 'bootstrap-tenant.ts'), 'utf8');
  assert.match(bootstrap, /--default-membership/);
  assert.match(bootstrap, /DEFAULT_MEMBERSHIP_GUARD/);
});

test('IoT status transitions skip forward and ignore stale same-generation regressions', async () => {
  process.env.TABLE_NAME ??= 'connected-enterprise-onboarding-unit-test';
  const { rollbackTargetMatches, transitionDisposition } = await import('../lambda/iot-status-handler.js');
  assert.equal(transitionDisposition('WAITING_FOR_DEVICE', 'APPLIED_HEALTHY', 'deployment'), 'APPLY');
  assert.equal(transitionDisposition('PERMANENT_IDENTITY_ACTIVE', 'HEALTH_CHECK', 'gateway'), 'APPLY');
  assert.equal(transitionDisposition('HEALTH_CHECK', 'APPLYING', 'gateway'), 'STALE_NOOP');
  assert.equal(transitionDisposition('APPLIED_HEALTHY', 'FAILED', 'gateway'), 'STALE_NOOP');
  assert.equal(transitionDisposition('ROLLED_BACK', 'ROLLING_BACK', 'deployment'), 'STALE_NOOP');
  assert.equal(transitionDisposition('QUARANTINED', 'ROLLED_BACK', 'gateway'), 'STALE_NOOP');
  const checksum = 'a'.repeat(64);
  assert.equal(rollbackTargetMatches('pv-applied', checksum, 'pv-applied', checksum), true);
  assert.equal(rollbackTargetMatches(undefined, undefined, 'pv-applied', checksum), false);
  assert.equal(rollbackTargetMatches('pv-applied', checksum, 'pv-failed', checksum), false);
});

test('IoT status transactions bind every DynamoDB expression placeholder for every device status', async () => {
  const [{ ddb }, { handler }] = await Promise.all([
    import('../lambda/shared/ddb.js'),
    import('../lambda/iot-status-handler.js'),
  ]);
  type CommandLike = { input: Record<string, unknown>; constructor: { name: string } };
  type MutableDdb = { send: (command: CommandLike) => Promise<unknown> };
  const client = ddb as unknown as MutableDdb;
  const originalSend = client.send;
  const checksum = 'a'.repeat(64);
  const rollbackChecksum = 'b'.repeat(64);
  const descriptor = { profileSha256: checksum };

  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const placeholders = (expression: string, prefix: '#' | ':') =>
    [...new Set(expression.match(new RegExp(`\\${prefix}[A-Za-z][A-Za-z0-9_]*`, 'g')) ?? [])].sort();
  const auditExpressionBindings = (node: unknown, pathLabel: string): void => {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => auditExpressionBindings(entry, `${pathLabel}[${index}]`));
      return;
    }
    if (!record(node)) return;

    const expression = Object.entries(node)
      .filter(([key, value]) => key.endsWith('Expression') && typeof value === 'string')
      .map(([, value]) => value)
      .join(' ');
    if (expression) {
      const nameMap = record(node.ExpressionAttributeNames) ? node.ExpressionAttributeNames : {};
      const valueMap = record(node.ExpressionAttributeValues) ? node.ExpressionAttributeValues : {};
      assert.deepEqual(Object.keys(nameMap).sort(), placeholders(expression, '#'),
        `${pathLabel} name placeholders are mapped exactly`);
      assert.deepEqual(Object.keys(valueMap).sort(), placeholders(expression, ':'),
        `${pathLabel} value placeholders are mapped exactly`);
    }
    Object.entries(node).forEach(([key, value]) => auditExpressionBindings(value, `${pathLabel}.${key}`));
  };

  const statuses = ['APPLYING', 'HEALTH_CHECK', 'APPLIED_HEALTHY', 'FAILED', 'ROLLING_BACK', 'ROLLED_BACK'] as const;
  const scenarios: Array<{
    label: string;
    status: (typeof statuses)[number];
    rollbackProfileVersionId?: string;
  }> = statuses.map((status) => ({ label: status, status }));
  scenarios.push({
    label: 'ROLLED_BACK_INVALID_ATTESTATION',
    status: 'ROLLED_BACK',
    rollbackProfileVersionId: 'pv-untrusted',
  });
  try {
    for (const { label, status, rollbackProfileVersionId } of scenarios) {
      const capturedInputs: Record<string, unknown>[] = [];
      let getIndex = 0;
      client.send = async (command) => {
        capturedInputs.push(command.input);
        if (command.constructor.name === 'QueryCommand') {
          return {
            Items: [{
              entityType: 'GATEWAY', tenantId: 'tenant-a', gatewayId: 'gateway-a',
              certificateId: 'certificate-a',
              certificatePrincipal: 'arn:aws:iot:us-east-1:111122223333:cert/certificate-a',
              certificateStatus: 'ACTIVE', thingName: 'gw-device-a', state: 'PROFILE_DELIVERED',
              generation: 1, desiredGeneration: 1, desiredProfileVersionId: 'pv-1',
              operationId: 'operation-a', signedDescriptor: descriptor,
              appliedProfileVersionId: 'pv-applied', appliedProfileChecksum: rollbackChecksum,
            }],
          };
        }
        if (command.constructor.name === 'GetCommand') {
          getIndex += 1;
          return getIndex === 1
            ? { Item: {
              PK: 'TENANT#tenant-a', SK: 'DEPLOYMENT#gateway-a#000000000001', tenantId: 'tenant-a',
              entityType: 'DEPLOYMENT', gatewayId: 'gateway-a', generation: 1,
              profileVersionId: 'pv-1', status: 'PROFILE_DELIVERED', operationId: 'operation-a',
              descriptor,
            } }
            : { Item: {
              PK: 'TENANT#tenant-a', SK: 'OPERATION#operation-a', tenantId: 'tenant-a',
              entityType: 'OPERATION', operationId: 'operation-a', gatewayId: 'gateway-a',
              profileVersionId: 'pv-1', deploymentGeneration: 1, state: 'PROFILE_DELIVERED', steps: [],
            } };
        }
        if (command.constructor.name === 'TransactWriteCommand') return {};
        throw new Error(`Unexpected DynamoDB command ${command.constructor.name}`);
      };

      await handler({
        generation: 1,
        status,
        brokerClientId: 'gw-device-a',
        brokerPrincipal: 'certificate-a',
        brokerTopic: 'ce/v1/gateways/gw-device-a/status',
        ...(status === 'APPLIED_HEALTHY' ? { profileVersionId: 'pv-1', profileChecksum: checksum } : {}),
        ...(status === 'ROLLED_BACK' ? {
          profileVersionId: rollbackProfileVersionId ?? 'pv-applied',
          profileChecksum: rollbackChecksum,
        } : {}),
      }, { awsRequestId: `request-${label.toLowerCase()}` } as Context);

      capturedInputs.forEach((input, index) => auditExpressionBindings(input, `${label}.command[${index}]`));
      const transaction = capturedInputs.find((input) => Array.isArray(input.TransactItems));
      assert.ok(transaction && Array.isArray(transaction.TransactItems), `${label} transaction was captured`);
      const deploymentUpdate = transaction.TransactItems
        .map((item) => record(item) && record(item.Update) ? item.Update : undefined)
        .find((update) => record(update?.Key) && String(update.Key.SK).startsWith('DEPLOYMENT#'));
      assert.ok(deploymentUpdate, `${label} deployment update was captured`);
      assert.deepEqual(deploymentUpdate.ExpressionAttributeNames, {
        '#status': 'status', '#error': 'error', '#descriptor': 'descriptor',
      },
        `${label} deployment update maps both reserved names`);
    }
  } finally {
    client.send = originalSend;
  }
});

test('outbox delivery fence accepts current assignment and supersedes stale redrive', async () => {
  process.env.TABLE_NAME ??= 'connected-enterprise-onboarding-unit-test';
  process.env.IOT_DATA_ENDPOINT ??= 'example-ats.iot.us-east-1.amazonaws.com';
  const { deliveryFenceDisposition } = await import('../lambda/outbox-handler.js');
  const current = {
    desiredGeneration: 2,
    gatewayProfileVersionId: 'pv-2',
    gatewayOperationId: 'op-2',
    gatewayCertificateStatus: 'ACTIVE',
    gatewayState: 'PROFILE_AVAILABLE',
    deploymentGeneration: 2,
    deploymentProfileVersionId: 'pv-2',
    deploymentOperationId: 'op-2',
    deploymentStatus: 'PROFILE_AVAILABLE',
  };
  assert.equal(deliveryFenceDisposition(current, { generation: 2, profileVersionId: 'pv-2', operationId: 'op-2' }), 'CURRENT');
  assert.equal(deliveryFenceDisposition(current, { generation: 1, profileVersionId: 'pv-1', operationId: 'op-1' }), 'SUPERSEDED');
  assert.equal(deliveryFenceDisposition({ ...current, gatewayState: 'APPLYING', deploymentStatus: 'HEALTH_CHECK' }, {
    generation: 2, profileVersionId: 'pv-2', operationId: 'op-2',
  }), 'DELIVERY_OBSERVED');
});

test('assignment, retry leases, and decommission are generation and manufacturing fenced', () => {
  const api = fs.readFileSync(path.join(process.cwd(), 'lambda', 'api-handler.ts'), 'utf8');
  const outbox = fs.readFileSync(path.join(process.cwd(), 'lambda', 'outbox-handler.ts'), 'utf8');
  const preHook = fs.readFileSync(path.join(process.cwd(), 'lambda', 'pre-provision-hook.ts'), 'utf8');
  assert.match(api, /ASSIGNABLE_GATEWAY_STATES = new Set\(\['APPLIED_HEALTHY', 'ROLLED_BACK'\]\)/);
  assert.doesNotMatch(api, /ASSIGNABLE_GATEWAY_STATES[^\n]*FAILED/);
  assert.match(api, /dispatchLeaseExpiresAtEpoch < :nowEpoch/);
  assert.match(api, /operationId, deploymentId, descriptor/);
  assert.match(api, /STUCK|DECOMMISSIONING|serialPk\(String\(gateway\.serialNumber\)\)/);
  assert.match(outbox, /SUPERSEDED/);
  assert.match(outbox, /Delivery lease is still active; retry/);
  assert.match(outbox, /REMOVE dispatchLeaseId, dispatchLeaseExpiresAtEpoch/);
  assert.match(outbox, /newStatus: 'REVOKED'/);
  assert.match(outbox, /serialPk\(serialNumber\)/);
  assert.match(outbox, /operationSk\(operationId\)[\s\S]*GATEWAY_DECOMMISSIONED/);
  assert.doesNotMatch(outbox, /decommission-operation-projection-failed/);
  assert.doesNotMatch(preHook, /eventType: record\.deliveryMode/);
  assert.match(preHook, /record\.state === 'PROVISIONED' && record\.certificateStatus === 'ACTIVE'/);
  const template = synthesized();
  template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
    StartingPosition: 'TRIM_HORIZON',
    MaximumRetryAttempts: 10,
    MaximumRecordAgeInSeconds: 900,
  });
});

test('legacy delivered assignments are migrated only from an exact lease-free delivery authority', async () => {
  const { legacyAssignmentMigrationAuthority } = await import('../lambda/api-handler.js');
  const nowEpoch = 1_800_000_000;
  const descriptor = {
    kind: 'gateway-profile-assignment',
    gatewayId: 'gateway-a',
    thingName: 'gw-device-a',
    generation: 1,
    profileVersionId: 'pv-1',
    signature: 'legacy-signature',
  };
  const gateway = {
    entityType: 'GATEWAY',
    gatewayId: 'gateway-a',
    thingName: 'gw-device-a',
    certificateStatus: 'ACTIVE',
    state: 'PROFILE_DELIVERED',
    generation: 1,
    desiredGeneration: 1,
    desiredProfileVersionId: 'pv-1',
    operationId: 'op-1',
    dispatchLeaseExpiresAtEpoch: nowEpoch - 1,
    signedDescriptor: descriptor,
  };
  const deployment = {
    entityType: 'DEPLOYMENT',
    gatewayId: 'gateway-a',
    generation: 1,
    profileVersionId: 'pv-1',
    operationId: 'op-1',
    status: 'PROFILE_DELIVERED',
    descriptor,
  };
  const operation = {
    entityType: 'OPERATION',
    operationId: 'op-1',
    gatewayId: 'gateway-a',
    deploymentGeneration: 1,
    profileVersionId: 'pv-1',
    operationStatus: 'IN_PROGRESS',
    state: 'PROFILE_STAGED',
  };

  assert.deepEqual(
    legacyAssignmentMigrationAuthority(gateway, deployment, operation, nowEpoch),
    { descriptor, operationId: 'op-1', profileVersionId: 'pv-1' },
  );
  const rejectedAuthorities: Array<[Record<string, unknown>, Record<string, unknown>, Record<string, unknown>]> = [
    [{ ...gateway, certificateStatus: 'INACTIVE' }, deployment, operation],
    [{ ...gateway, dispatchLeaseExpiresAtEpoch: nowEpoch }, deployment, operation],
    [{ ...gateway, signedDescriptor: { ...descriptor, configurationClaim: {} } }, deployment, operation],
    [{ ...gateway, signedDescriptor: undefined }, deployment, operation],
    [gateway, { ...deployment, status: 'APPLIED_HEALTHY' }, operation],
    [gateway, deployment, { ...operation, operationStatus: 'SUCCEEDED' }],
    [gateway, deployment, { ...operation, operationId: 'op-racing' }],
  ];
  for (const authority of rejectedAuthorities) {
    assert.throws(
      () => legacyAssignmentMigrationAuthority(...authority, nowEpoch),
      /cannot be migrated safely/,
    );
  }

  const api = fs.readFileSync(path.join(process.cwd(), 'lambda', 'api-handler.ts'), 'utf8');
  assert.match(api, /#status = :superseded[\s\S]*':superseded': 'SUPERSEDED'/);
  assert.match(api, /#descriptor = :descriptor[\s\S]*'#descriptor': 'descriptor'/);
  assert.doesNotMatch(api, / AND descriptor = :descriptor/);
  assert.match(api, /code: 'LEGACY_ASSIGNMENT_SUPERSEDED'/);
  assert.match(api, /supersededByGeneration/);
  assert.match(api, /#state IN \(:healthy, :rolledBack\)/);
});

test('signing key identity is inside signed manifests and retrieval validation', () => {
  const profile = fs.readFileSync(path.join(process.cwd(), 'lambda', 'shared', 'profile.ts'), 'utf8');
  const config = fs.readFileSync(path.join(process.cwd(), 'lambda', 'iot-config-handler.ts'), 'utf8');
  assert.match(profile, /signedManifest = \{ \.\.\.manifest, signingKeyId: SIGNING_KEY_ID \}/);
  assert.match(config, /descriptor\.signingKeyId !== SIGNING_KEY_ID/);
  synthesized().hasResourceProperties('AWS::Lambda::Function', {
    FunctionName: 'connected-enterprise-onboarding-dev-iot-config',
    Environment: { Variables: { SIGNING_KEY_ID: Match.anyValue() } },
  });
});

test('gateway projection preserves quarantine and authoritative certificate status', async () => {
  process.env.TABLE_NAME ??= 'connected-enterprise-onboarding-unit-test';
  const { publicGateway } = await import('../lambda/api-handler.js');
  const quarantined = publicGateway({ state: 'QUARANTINED', certificateStatus: 'INACTIVE' });
  assert.equal(quarantined.state, 'QUARANTINED');
  assert.equal(quarantined.certificateState, 'INACTIVE');
  const identityActive = publicGateway({ state: 'PERMANENT_IDENTITY_ACTIVE', certificateStatus: 'ACTIVE' });
  assert.equal(identityActive.certificateState, 'ACTIVE');
  const revoking = publicGateway({ state: 'DECOMMISSIONING', certificateStatus: 'REVOKING' });
  assert.equal(revoking.certificateState, 'DEACTIVATING');
  const rolledBack = publicGateway({
    state: 'ROLLED_BACK', certificateStatus: 'ACTIVE', appliedProfileVersionId: 'pv-applied',
    desiredProfileVersionId: 'pv-failed', appliedProfileChecksum: 'b'.repeat(64),
  });
  assert.equal(rolledBack.state, 'ROLLED_BACK');
  assert.equal(rolledBack.profileVersionId, 'pv-applied');
  assert.equal(rolledBack.desiredProfileVersionId, 'pv-failed');
});

test('rollback convergence validates target, preserves generation, and clears failed desired shadow', () => {
  const status = fs.readFileSync(path.join(process.cwd(), 'lambda', 'iot-status-handler.ts'), 'utf8');
  const outbox = fs.readFileSync(path.join(process.cwd(), 'lambda', 'outbox-handler.ts'), 'utf8');
  const api = fs.readFileSync(path.join(process.cwd(), 'lambda', 'api-handler.ts'), 'utf8');
  assert.match(status, /eventType: 'CLEAR_CONFIG_SHADOW'/);
  assert.match(status, /rolledBackToProfileVersionId/);
  assert.match(status, /ROLLBACK_ATTESTATION_FAILED/);
  assert.match(status, /REMOVE desiredProfileVersionId, signedDescriptor/);
  assert.match(outbox, /state: \{ desired: null \}/);
  assert.match(outbox, /Rollback clear generation .* was superseded/);
  assert.match(api, /previousProfileVersionId: gateway\.appliedProfileVersionId/);
  assert.doesNotMatch(status, /desiredGeneration\s*=\s*:previous/);
});

test('snapshot reads bounded entity namespaces and includes active operations without audit scans', () => {
  const api = fs.readFileSync(path.join(process.cwd(), 'lambda', 'api-handler.ts'), 'utf8');
  const ddbSource = fs.readFileSync(path.join(process.cwd(), 'lambda', 'shared', 'ddb.ts'), 'utf8');
  for (const prefix of ['SITE#', 'MODEL#', 'PROFILE_VERSION#', 'GATEWAY#']) assert.match(api, new RegExp(prefix));
  assert.match(api, /recentTenantOperations\(tenantId, 100\)/);
  assert.match(api, /operationsById/);
  assert.match(api, /BatchGetCommand/);
  assert.doesNotMatch(api, /async function tenantItems/);
  assert.doesNotMatch(api, /Tenant snapshot exceeds/);
  assert.match(ddbSource, /PROFILE_VERSION#/);
  assert.match(ddbSource, /DEPLOYMENT#/);
  synthesized().hasResourceProperties('AWS::DynamoDB::Table', {
    GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: 'GSI3' })]),
  });
});

test('idempotency keys require the shared 8-128 character contract', async () => {
  const { idempotencyKey } = await import('../lambda/shared/http.js');
  const event = (key: string) => ({ headers: { 'idempotency-key': key } }) as unknown as Parameters<typeof idempotencyKey>[0];
  assert.throws(() => idempotencyKey(event('short')), /8-128/);
  assert.equal(idempotencyKey(event('request-1234')), 'request-1234');
});

test('one-time reservation and outbox retries stay server-authoritative', () => {
  const preHook = fs.readFileSync(path.join(process.cwd(), 'lambda', 'pre-provision-hook.ts'), 'utf8');
  const outbox = fs.readFileSync(path.join(process.cwd(), 'lambda', 'outbox-handler.ts'), 'utf8');
  assert.doesNotMatch(preHook, /parameters\.VerificationId/);
  assert.match(preHook, /ENROLLMENT_PENDING/);
  assert.doesNotMatch(preHook, /outboxSk/);
  assert.match(outbox, /lastAttemptStatus/);
  assert.match(outbox, /FAILED_RETRYABLE/);
  assert.doesNotMatch(outbox, /':failed': 'FAILED'/);
});
