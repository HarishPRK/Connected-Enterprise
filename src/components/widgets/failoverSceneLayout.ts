// Shared by the equipment layout and the industrial room, so stations stay inside their premises.
export const TWIN_LAYOUT = {
  devicesX: -14.8,
  gatewayX: -10,
  underlayX: -5.2,
  tunnelsX: 0.6,
  sdwanX: 6.5,
  internetX: 11.4,
  cloudX: 16.3,
  devicesZ: 3.2,
  underlayZ: 3.7,
  tunnelSpread: 10.2,
  premisesDepth: 13.2,
  enterprise: { width: 20, centerX: -6.8 },
  operator: { width: 14.2, centerX: 11.3 },
  room: { width: 37.2, depth: 15.2, centerX: 0.8 },
} as const;
