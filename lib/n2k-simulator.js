/**
 * N2kSimulator - NMEA 2000 data simulation
 *
 * Simulates NMEA 2000 data in canboat JSON format
 * for testing N2K input processing.
 */

const net = require('net');
const fs = require('fs');

class N2kSimulator {
  constructor(options = {}) {
    this.host = options.host || 'localhost';
    this.port = options.port || 2597;
  }

  /**
   * Generate canboat-style JSON for a PGN
   */
  generatePgn(pgn, fields) {
    const timestamp = new Date().toISOString();
    return JSON.stringify({
      timestamp,
      prio: 2,
      src: 0,
      dst: 255,
      pgn,
      description: this.getPgnDescription(pgn),
      fields,
    });
  }

  /**
   * Get human-readable PGN description
   */
  getPgnDescription(pgn) {
    const descriptions = {
      127250: 'Vessel Heading',
      128259: 'Speed',
      128267: 'Water Depth',
      129025: 'Position, Rapid Update',
      129026: 'COG & SOG, Rapid Update',
      129029: 'GNSS Position Data',
      130306: 'Wind Data',
      130310: 'Environmental Parameters',
      130311: 'Environmental Parameters',
      127245: 'Rudder',
      127488: 'Engine Parameters, Rapid Update',
      127489: 'Engine Parameters, Dynamic',
      127505: 'Fluid Level',
      127508: 'Battery Status',
    };
    return descriptions[pgn] || `PGN ${pgn}`;
  }

  /**
   * Generate Position Rapid Update (129025)
   */
  generatePosition(lat, lon) {
    return this.generatePgn(129025, {
      Latitude: lat,
      Longitude: lon,
    });
  }

  /**
   * Generate COG & SOG Rapid Update (129026)
   */
  generateCogSog(cog, sog) {
    return this.generatePgn(129026, {
      'COG Reference': 'True',
      COG: cog,
      SOG: sog,
    });
  }

  /**
   * Generate Vessel Heading (127250)
   */
  generateHeading(heading, deviation = 0, variation = 0) {
    return this.generatePgn(127250, {
      Heading: heading,
      Deviation: deviation,
      Variation: variation,
      Reference: 'Magnetic',
    });
  }

  /**
   * Generate Water Depth (128267)
   */
  generateDepth(depth, offset = 0) {
    return this.generatePgn(128267, {
      Depth: depth,
      Offset: offset,
    });
  }

  /**
   * Generate Wind Data (130306)
   */
  generateWind(speed, angle, reference = 'Apparent') {
    return this.generatePgn(130306, {
      'Wind Speed': speed,
      'Wind Angle': angle,
      Reference: reference,
    });
  }

  /**
   * Generate Speed (128259)
   */
  generateSpeed(speedWater, speedGround = null) {
    const fields = {
      'Speed Water Referenced': speedWater,
    };
    if (speedGround !== null) {
      fields['Speed Ground Referenced'] = speedGround;
    }
    return this.generatePgn(128259, fields);
  }

  /**
   * Generate Environmental Parameters (130310)
   */
  generateEnvironment(waterTemp, airTemp = null, pressure = null) {
    const fields = {
      'Water Temperature': waterTemp,
    };
    if (airTemp !== null) {
      fields['Outside Ambient Air Temperature'] = airTemp;
    }
    if (pressure !== null) {
      fields['Atmospheric Pressure'] = pressure;
    }
    return this.generatePgn(130310, fields);
  }

  /**
   * Generate Engine Parameters Rapid (127488)
   */
  generateEngineRapid(instance, rpm, tilt = 0) {
    return this.generatePgn(127488, {
      'Engine Instance': instance,
      'Engine Speed': rpm,
      'Engine Tilt/Trim': tilt,
    });
  }

  /**
   * Generate Battery Status (127508)
   */
  generateBattery(instance, voltage, current, temperature = null) {
    const fields = {
      'Battery Instance': instance,
      Voltage: voltage,
      Current: current,
    };
    if (temperature !== null) {
      fields.Temperature = temperature;
    }
    return this.generatePgn(127508, fields);
  }

  /**
   * Generate Fluid Level (127505)
   */
  generateFluidLevel(instance, type, level, capacity) {
    return this.generatePgn(127505, {
      Instance: instance,
      'Fluid Type': type,
      Level: level,
      Capacity: capacity,
    });
  }

  /**
   * Send N2K data via TCP (canboat format)
   */
  async sendTcp(messages, options = {}) {
    const delay = options.delay || 100;
    const messageArray = Array.isArray(messages) ? messages : [messages];
    const results = { sent: 0, errors: [] };

    return new Promise((resolve, reject) => {
      const client = new net.Socket();

      client.connect(this.port, this.host, async () => {
        for (const msg of messageArray) {
          try {
            const line = msg.endsWith('\n') ? msg : `${msg}\n`;
            client.write(line);
            results.sent++;

            if (delay > 0) {
              await new Promise((r) => setTimeout(r, delay));
            }
          } catch (e) {
            results.errors.push({ error: e.message });
          }
        }

        client.end();
        resolve(results);
      });

      client.on('error', reject);
    });
  }

  /**
   * Generate a navigation burst with multiple PGNs
   */
  generateNavigationBurst(count, config = {}) {
    const messages = [];
    let lat = config.startLat || 60.0;
    let lon = config.startLon || 24.0;
    let heading = config.heading || 90;
    let sog = config.sog || 5.0;
    let cog = config.cog || 90;

    for (let i = 0; i < count; i++) {
      // Simulate movement
      lat += (Math.random() - 0.5) * 0.0001;
      lon += (Math.random() - 0.5) * 0.0001;
      heading += (Math.random() - 0.5) * 2;
      sog += (Math.random() - 0.5) * 0.5;
      cog += (Math.random() - 0.5) * 2;

      // Position
      messages.push(this.generatePosition(lat, lon));

      // COG/SOG
      messages.push(this.generateCogSog(cog, sog));

      // Heading every 2nd
      if (i % 2 === 0) {
        messages.push(this.generateHeading(heading));
      }

      // Speed every 3rd
      if (i % 3 === 0) {
        messages.push(this.generateSpeed(sog * 0.9, sog));
      }
    }

    return messages;
  }

  /**
   * Generate environment data burst
   */
  generateEnvironmentBurst(count, config = {}) {
    const messages = [];
    const baseDepth = config.depth || 10;
    const baseWindSpeed = config.windSpeed || 10;
    const baseWindAngle = config.windAngle || 45;

    for (let i = 0; i < count; i++) {
      // Depth
      const depth = baseDepth + (Math.random() - 0.5) * 2;
      messages.push(this.generateDepth(depth));

      // Apparent wind
      const windSpeed = baseWindSpeed + (Math.random() - 0.5) * 3;
      const windAngle = baseWindAngle + (Math.random() - 0.5) * 10;
      messages.push(this.generateWind(windSpeed, windAngle, 'Apparent'));

      // True wind every 3rd
      if (i % 3 === 0) {
        messages.push(
          this.generateWind(windSpeed * 0.9, windAngle + 10, 'True (boat referenced)')
        );
      }

      // Environment every 5th
      if (i % 5 === 0) {
        const waterTemp = 15 + Math.random() * 3;
        const airTemp = 20 + Math.random() * 5;
        messages.push(this.generateEnvironment(waterTemp, airTemp));
      }
    }

    return messages;
  }

  /**
   * Generate engine monitoring burst
   */
  generateEngineBurst(count, config = {}) {
    const messages = [];
    const baseRpm = config.rpm || 2500;
    const engines = config.engines || 1;

    for (let i = 0; i < count; i++) {
      for (let engine = 0; engine < engines; engine++) {
        const rpm = baseRpm + (Math.random() - 0.5) * 200;
        messages.push(this.generateEngineRapid(engine, rpm));
      }

      // Battery every 10th
      if (i % 10 === 0) {
        const voltage = 12.5 + Math.random() * 1;
        const current = 10 + Math.random() * 5;
        messages.push(this.generateBattery(0, voltage, current));
      }

      // Fuel level every 20th
      if (i % 20 === 0) {
        messages.push(this.generateFluidLevel(0, 'Fuel', 75, 200));
      }
    }

    return messages;
  }

  /**
   * Stream a canboat log file
   */
  async streamFile(filePath, options = {}) {
    const delay = options.delay || 100;
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());

    return this.sendTcp(lines, { delay });
  }
}

module.exports = { N2kSimulator };
