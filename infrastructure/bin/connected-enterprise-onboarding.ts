#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ConnectedEnterpriseOnboardingStack } from '../lib/connected-enterprise-onboarding-stack.js';

const app = new cdk.App();
const stage = String(app.node.tryGetContext('stage') ?? 'dev');
const account = process.env.CDK_DEFAULT_ACCOUNT;

if (stage !== 'dev') {
  throw new Error('This app is intentionally pinned to the dev stage. Create and review a separate stack before enabling staging or production.');
}

new ConnectedEnterpriseOnboardingStack(app, 'ConnectedEnterpriseOnboarding-dev', {
  stackName: 'ConnectedEnterpriseOnboarding-dev',
  description: 'Isolated Connected Enterprise gateway onboarding and immutable profile control plane (dev)',
  env: {
    ...(account ? { account } : {}),
    region: 'us-east-1',
  },
  stage,
  terminationProtection: true,
});
