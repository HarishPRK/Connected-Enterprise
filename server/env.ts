import { config as loadDotenv } from 'dotenv';

// Load the project environment before modules such as ipsecSource evaluate
// their top-level topic configuration. Keeping this in a first-imported side
// effect module preserves the existing "project .env wins" development policy.
loadDotenv({ override: true });
