# Temporary onboarding without sign-in

This optional EC2 mode gives every visitor live onboarding access to the single
configured tenant, using the service actor `anonymous-ec2-onboarding-dev`. It uses
the existing AWS API Lambda and its validation, operations, audit records, and
bootstrap ZIP downloads. Browser requests need no Cognito token, cookie, or access
link. The normal Cognito mode remains available when this feature is disabled.

## One-time AWS permission

The EC2 instance role `ce-ec2-iot-role` currently cannot invoke the onboarding API.
An AWS administrator must open **IAM → Roles → ce-ec2-iot-role → Add permissions →
Create inline policy → JSON**, paste the exact contents of
[`ec2-temporary-onboarding-policy.json`](../config/ec2-temporary-onboarding-policy.json),
and save it as `TemporaryDevelopmentOnboarding`.

This grants only `lambda:InvokeFunction` on the development onboarding API Lambda.
It adds no IAM, Cognito, DynamoDB, or IoT permissions to EC2. No local AWS CLI setup
is required for the console action.

## Activation on EC2

Do not enable the feature until the role can invoke the exact API function and a
read-only `/snapshot` request through `createOnboardingAwsBridge` succeeds for
`ce-test`. A Lambda DryRun checks IAM without creating an onboarding operation.
Do not register a gateway or issue bootstrap certificates as a deployment probe.

After permission is confirmed, configure `/home/ubuntu/connected-enterprise/.env`:

```dotenv
ONBOARDING_PUBLIC_AWS_ENABLED=true
ONBOARDING_PUBLIC_AWS_REGION=us-east-1
ONBOARDING_PUBLIC_AWS_FUNCTION_ARN=arn:aws:lambda:us-east-1:841019700679:function:connected-enterprise-onboarding-dev-api
ONBOARDING_PUBLIC_AWS_TENANT_ID=ce-test
ONBOARDING_PUBLIC_AWS_EXPIRES_AT=<explicit ISO UTC timestamp within the next seven days>
ONBOARDING_PUBLIC_AWS_ORIGINS=https://connectedenterprise.app,http://32.198.156.143
```

Restart `connected-enterprise` through PM2. Check `/api/health`, then confirm
`/api/onboarding/access-mode` returns `temporary-public-aws` with the intended
tenant and expiry. Open `/onboarding` in a fresh browser session and verify the
live inventory loads without Sign in or Sign out controls. The feature uses
polling, preserving the existing remote AWS workflow.

The API checks expiry on every request. Only the existing nine operator routes
are forwarded, with a fixed tenant and actor. Browser-supplied credentials and
identity cannot change the invocation context. POST requests require a configured
Origin, JSON, and an idempotency key; these checks prevent accidental cross-site
submissions, not intentional use of this public feature.

## Disable

Set `ONBOARDING_PUBLIC_AWS_ENABLED=false` and restart the PM2 app. Remove the
`TemporaryDevelopmentOnboarding` inline policy when it is no longer needed.
The original Cognito configuration and API Gateway authorizer are unchanged.
