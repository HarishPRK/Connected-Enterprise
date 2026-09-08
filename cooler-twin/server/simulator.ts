import { STOCK_COLUMNS, STOCK_ROWS, type CoolerCommand, type Telemetry } from '../shared/telemetry.js';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rounded = (value: number, places = 2) => Number(value.toFixed(places));

/** Lumped-air demonstration model, not a calibrated refrigeration/food-safety model. */
export class CoolerSimulator {
  private data!: Telemetry;
  private clockSeconds = 0;
  private compressorDwell = 90;
  private runningSeconds = 171;
  private observedSeconds = 600;
  private doorSeconds = 0;
  private highTemperatureSeconds = 0;
  private sequence = 0;
  private temperatures = [3.5, 3.2, 2.9];
  private humidity = 48;
  private energy = 0;
  private runtimeSeconds = 8100;

  constructor(private readonly deviceId = 'GDM-001', private readonly now = () => new Date()) {
    this.reset();
  }

  private reset() {
    this.clockSeconds = 0;
    this.compressorDwell = 90;
    this.runningSeconds = 171;
    this.observedSeconds = 600;
    this.doorSeconds = 0;
    this.highTemperatureSeconds = 0;
    this.temperatures = [3.5, 3.2, 2.9];
    this.humidity = 48;
    this.energy = 0;
    this.runtimeSeconds = 8100;
    this.data = {
      schemaVersion: 1, deviceId: this.deviceId, sequence: this.sequence,
      timestamp: this.now().toISOString(), source: 'simulator', doorOpen: false,
      temperature: { top: 3.5, middle: 3.2, bottom: 2.9, setpoint: 3, ambient: 24 },
      humidity: 48,
      compressor: { running: true, currentAmps: 2.14, pressureBar: 8.2, dutyCycle: 28.5, runtimeSeconds: 8100, vibrationHz: 45 },
      stock: Array.from({ length: STOCK_ROWS }, (_, row) => Array.from({ length: STOCK_COLUMNS }, (_, col) => ![[0, 6], [1, 2], [2, 5], [3, 7], [4, 0], [4, 1]].some(([r, c]) => r === row && c === col))),
      powerWatts: 257, energyKwh: 0, alarms: [],
    };
  }

  snapshot(): Telemetry {
    return structuredClone(this.data);
  }

  command(command: CoolerCommand): Telemetry {
    switch (command.command) {
      case 'set-door':
        this.data.doorOpen = command.value;
        if (!command.value) this.doorSeconds = 0;
        break;
      case 'set-setpoint': this.data.temperature.setpoint = command.value; break;
      case 'set-stock': this.data.stock[command.value.row]![command.value.col] = command.value.filled; break;
      case 'restock': this.data.stock = Array.from({ length: STOCK_ROWS }, () => Array(STOCK_COLUMNS).fill(true) as boolean[]); break;
      case 'reset': this.reset(); break;
    }
    return this.tick(0);
  }

  /** Pass elapsed (simulation) seconds. Integrates in <=1 s steps for stable delayed timers. */
  tick(elapsedSeconds = 1): Telemetry {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || elapsedSeconds > 3600) throw new RangeError('Elapsed seconds must be between 0 and 3600');
    let remaining = elapsedSeconds;
    while (remaining > 0) {
      const dt = Math.min(remaining, 1);
      remaining -= dt;
      this.clockSeconds += dt;
      this.compressorDwell += dt;
      this.observedSeconds += dt;
      const { setpoint, ambient } = this.data.temperature;
      const middle = this.temperatures[1]!;
      if (this.compressorDwell >= 60) {
        if (this.data.compressor.running && middle < setpoint - 0.5) { this.data.compressor.running = false; this.compressorDwell = 0; }
        else if (!this.data.compressor.running && middle > setpoint + 0.5) { this.data.compressor.running = true; this.compressorDwell = 0; }
      }
      const running = this.data.compressor.running;
      const door = this.data.doorOpen;
      // Each zone exchanges heat with ambient and mixed return air. Warm air enters at the top.
      this.temperatures = this.temperatures.map((temperature, zone) => {
        const ambientTau = door ? [140, 190, 240][zone]! : [2700, 3000, 3400][zone]!;
        const mixing = (middle - temperature) * 0.004;
        const cooling = running ? [0.023, 0.025, 0.027][zone]! * (door ? 0.35 : 1) : 0;
        return clamp(temperature + ((ambient - temperature) / ambientTau + mixing - cooling) * dt, -5, ambient);
      });
      const humidityTarget = door ? 73 : running ? 43 : 51;
      this.humidity += (humidityTarget - this.humidity) * (1 - Math.exp(-dt / (door ? 45 : 220)));
      this.doorSeconds = door ? this.doorSeconds + dt : 0;
      this.highTemperatureSeconds = this.temperatures[1]! > 8 ? this.highTemperatureSeconds + dt : 0;
      if (running) { this.runningSeconds += dt; this.runtimeSeconds += dt; }
      const load = clamp((this.temperatures[1]! - setpoint) / 12, 0, 1);
      this.energy += (35 + (running ? 222 + 45 * load : 0)) * dt / 3_600_000;
    }

    const wobble = Math.sin(this.clockSeconds / 13) * 0.025 + Math.sin(this.clockSeconds / 4.7) * 0.01;
    const { running } = this.data.compressor;
    const load = clamp((this.temperatures[1]! - this.data.temperature.setpoint) / 12, 0, 1);
    this.data.temperature.top = rounded(this.temperatures[0]! + wobble, 2);
    this.data.temperature.middle = rounded(this.temperatures[1]! + wobble * 0.7, 2);
    this.data.temperature.bottom = rounded(this.temperatures[2]! + wobble * 0.5, 2);
    this.data.humidity = rounded(this.humidity + wobble * 3, 1);
    this.data.compressor.currentAmps = running ? rounded(2.14 + load * 0.45 + wobble) : 0;
    this.data.compressor.pressureBar = rounded(running ? 8.2 + load * 1.4 + wobble : 5.2 + wobble);
    this.data.compressor.vibrationHz = running ? rounded(45 + Math.sin(this.clockSeconds / 7) * 0.65, 1) : 0;
    this.data.compressor.dutyCycle = rounded(this.runningSeconds / this.observedSeconds * 100, 1);
    this.data.compressor.runtimeSeconds = rounded(this.runtimeSeconds, 1);
    this.data.powerWatts = rounded(35 + (running ? 222 + 45 * load : 0), 1);
    this.data.energyKwh = rounded(this.energy, 6);
    this.data.alarms = [];
    if (this.doorSeconds >= 30) this.data.alarms.push({ id: 'door-open', severity: 'warning', message: 'Door has been open for over 30 seconds.' });
    if (this.highTemperatureSeconds >= 60) this.data.alarms.push({ id: 'high-temperature', severity: 'critical', message: 'Middle-zone air temperature has exceeded 8°C for 60 seconds.' });
    if (this.data.stock.flat().filter(Boolean).length < 12) this.data.alarms.push({ id: 'low-stock', severity: 'warning', message: 'Stock is below 30% of shelf capacity.' });
    this.data.sequence = ++this.sequence;
    this.data.timestamp = this.now().toISOString();
    return this.snapshot();
  }
}
