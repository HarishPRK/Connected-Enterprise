export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const TABLE_NAME = requireEnv('TABLE_NAME');
export const ARTIFACT_BUCKET = process.env.ARTIFACT_BUCKET?.trim() ?? '';
export const SIGNING_KEY_ID = process.env.SIGNING_KEY_ID?.trim() ?? '';
export const HARDWARE_PROOF_SECRET_ARN = process.env.HARDWARE_PROOF_SECRET_ARN?.trim() ?? '';
export const IOT_DATA_ENDPOINT = process.env.IOT_DATA_ENDPOINT?.trim() ?? '';
export const JOB_TEMPLATE_ARN = process.env.JOB_TEMPLATE_ARN?.trim() ?? '';
export const STAGE = process.env.STAGE?.trim() ?? 'dev';
export const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID?.trim() ?? '';
export const AWS_REGION_NAME = process.env.AWS_REGION?.trim() ?? 'us-east-1';
