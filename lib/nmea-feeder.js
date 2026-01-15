/**
 * NmeaFeeder - NMEA 0183 data transmission
 *
 * Sends NMEA sentences to SignalK server via TCP/UDP
 * for testing data input processing.
 */

const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const { NmeaFixtures } = require('./nmea-fixtures');

class NmeaFeeder {
  constructor(options = {}) {
    this.tcpHost = options.tcpHost || 'localhost';
    this.tcpPort = options.tcpPort || 10110;
    this.udpHost = options.udpHost || 'localhost';
    this.udpPort = options.udpPort || 10111;
    this.defaultDelay = options.delay || 100; // ms between sentences
  }

  /**
   * Send NMEA sentences via TCP
   */
  async sendTcp(sentences, options = {}) {
    const delay = options.delay ?? this.defaultDelay;
    const sentenceArray = Array.isArray(sentences) ? sentences : [sentences];
    const results = { sent: 0, errors: [], duration: 0 };
    const start = Date.now();

    return new Promise((resolve, reject) => {
      const client = new net.Socket();
      let connected = false;

      client.setTimeout(options.timeout || 10000);

      client.connect(this.tcpPort, this.tcpHost, async () => {
        connected = true;

        for (const sentence of sentenceArray) {
          try {
            const line = sentence.endsWith('\r\n') ? sentence : `${sentence}\r\n`;
            await new Promise((res, rej) => {
              client.write(line, (err) => {
                if (err) rej(err);
                else res();
              });
            });
            results.sent++;

            if (delay > 0 && sentenceArray.indexOf(sentence) < sentenceArray.length - 1) {
              await new Promise((r) => setTimeout(r, delay));
            }
          } catch (e) {
            results.errors.push({ sentence, error: e.message });
          }
        }

        client.end();
        results.duration = Date.now() - start;
        resolve(results);
      });

      client.on('error', (err) => {
        if (!connected) {
          reject(new Error(`TCP connection failed: ${err.message}`));
        } else {
          results.errors.push({ error: err.message });
        }
      });

      client.on('timeout', () => {
        client.destroy();
        reject(new Error('TCP connection timeout'));
      });
    });
  }

  /**
   * Send NMEA sentences via UDP
   */
  async sendUdp(sentences, options = {}) {
    const delay = options.delay ?? this.defaultDelay;
    const sentenceArray = Array.isArray(sentences) ? sentences : [sentences];
    const results = { sent: 0, errors: [], duration: 0 };
    const start = Date.now();

    const client = dgram.createSocket('udp4');

    for (const sentence of sentenceArray) {
      try {
        const line = sentence.endsWith('\r\n') ? sentence : `${sentence}\r\n`;
        await new Promise((resolve, reject) => {
          client.send(line, this.udpPort, this.udpHost, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        results.sent++;

        if (delay > 0 && sentenceArray.indexOf(sentence) < sentenceArray.length - 1) {
          await new Promise((r) => setTimeout(r, delay));
        }
      } catch (e) {
        results.errors.push({ sentence, error: e.message });
      }
    }

    client.close();
    results.duration = Date.now() - start;
    return results;
  }

  /**
   * Stream NMEA file to server
   */
  async streamFile(filePath, protocol = 'tcp', options = {}) {
    const delay = options.delay ?? this.defaultDelay;
    const results = { sent: 0, errors: [], duration: 0, file: filePath };
    const start = Date.now();

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    const sendFn =
      protocol === 'udp' ? this.sendUdp.bind(this) : this.sendTcp.bind(this);

    const sentences = [];
    for await (const line of rl) {
      if (line.trim() && (line.startsWith('$') || line.startsWith('!'))) {
        sentences.push(line.trim());
      }
    }

    // Send in batches for efficiency
    const batchSize = options.batchSize || 50;
    for (let i = 0; i < sentences.length; i += batchSize) {
      const batch = sentences.slice(i, i + batchSize);
      try {
        const result = await sendFn(batch, { delay });
        results.sent += result.sent;
        results.errors.push(...result.errors);
      } catch (e) {
        results.errors.push({ batch: i, error: e.message });
      }
    }

    results.duration = Date.now() - start;
    return results;
  }

  /**
   * Run a scenario file
   */
  async runScenario(scenarioPath, options = {}) {
    const scenario = JSON.parse(fs.readFileSync(scenarioPath, 'utf-8'));
    const results = {
      name: scenario.name,
      phases: [],
      totalSent: 0,
      totalErrors: 0,
      duration: 0,
    };
    const start = Date.now();

    for (const phase of scenario.phases) {
      const phaseResult = {
        name: phase.name,
        protocol: phase.protocol || 'tcp',
        sent: 0,
        errors: [],
      };

      const sendFn =
        phase.protocol === 'udp' ? this.sendUdp.bind(this) : this.sendTcp.bind(this);

      try {
        if (phase.file) {
          // Resolve file path relative to scenario file
          const filePath = path.isAbsolute(phase.file)
            ? phase.file
            : path.join(path.dirname(scenarioPath), phase.file);

          const fileResult = await this.streamFile(filePath, phase.protocol, {
            delay: phase.delay,
          });
          phaseResult.sent = fileResult.sent;
          phaseResult.errors = fileResult.errors;
        } else if (phase.sentences) {
          const sendResult = await sendFn(phase.sentences, { delay: phase.delay });
          phaseResult.sent = sendResult.sent;
          phaseResult.errors = sendResult.errors;
        } else if (phase.generate) {
          // Generate synthetic data
          const sentences = this.generateData(phase.generate);
          const sendResult = await sendFn(sentences, { delay: phase.delay });
          phaseResult.sent = sendResult.sent;
          phaseResult.errors = sendResult.errors;
        }
      } catch (e) {
        phaseResult.errors.push({ phase: phase.name, error: e.message });
      }

      results.phases.push(phaseResult);
      results.totalSent += phaseResult.sent;
      results.totalErrors += phaseResult.errors.length;

      // Inter-phase pause
      if (phase.pauseAfter) {
        await new Promise((r) => setTimeout(r, phase.pauseAfter));
      }
    }

    results.duration = Date.now() - start;
    return results;
  }

  /**
   * Generate synthetic NMEA data
   */
  generateData(config) {
    const type = config.type || 'navigation';
    const count = config.count || 100;

    switch (type) {
      case 'navigation':
        return this.generateNavigationBurst(count, config);
      case 'environment':
        return this.generateEnvironmentBurst(count, config);
      case 'ais':
        return this.generateAisBurst(count, config);
      default:
        return this.generateNavigationBurst(count, config);
    }
  }

  /**
   * Generate navigation NMEA sentences
   */
  generateNavigationBurst(count, config = {}) {
    const sentences = [];
    let lat = config.startLat || 60.0;
    let lon = config.startLon || 24.0;
    const speed = config.speed || 5.0;
    const course = config.course || 90.0;

    for (let i = 0; i < count; i++) {
      // Simulate movement
      const latChange = (Math.random() - 0.5) * 0.001;
      const lonChange = (Math.random() - 0.5) * 0.001;
      lat += latChange;
      lon += lonChange;

      const latDeg = Math.floor(Math.abs(lat));
      const latMin = (Math.abs(lat) - latDeg) * 60;
      const lonDeg = Math.floor(Math.abs(lon));
      const lonMin = (Math.abs(lon) - lonDeg) * 60;

      const time = new Date();
      const timeStr = time.toISOString().replace(/[-:T]/g, '').substring(8, 14);
      const dateStr = time.toISOString().replace(/[-]/g, '').substring(2, 8);

      // RMC sentence
      const speedVar = speed + (Math.random() - 0.5) * 2;
      const courseVar = course + (Math.random() - 0.5) * 10;

      const rmc = `$GPRMC,${timeStr},A,${latDeg}${latMin.toFixed(4)},${lat >= 0 ? 'N' : 'S'},${lonDeg.toString().padStart(3, '0')}${lonMin.toFixed(4)},${lon >= 0 ? 'E' : 'W'},${speedVar.toFixed(1)},${courseVar.toFixed(1)},${dateStr},0.0,E,A`;
      sentences.push(this.addChecksum(rmc));

      // Add GGA every 5th sentence
      if (i % 5 === 0) {
        const gga = `$GPGGA,${timeStr},${latDeg}${latMin.toFixed(4)},${lat >= 0 ? 'N' : 'S'},${lonDeg.toString().padStart(3, '0')}${lonMin.toFixed(4)},${lon >= 0 ? 'E' : 'W'},1,08,0.9,10.0,M,47.0,M,,`;
        sentences.push(this.addChecksum(gga));
      }

      // Add HDG every 3rd sentence
      if (i % 3 === 0) {
        const hdg = `$HCHDG,${courseVar.toFixed(1)},0.0,E,0.0,W`;
        sentences.push(this.addChecksum(hdg));
      }
    }

    return sentences;
  }

  /**
   * Generate environment NMEA sentences
   */
  generateEnvironmentBurst(count, config = {}) {
    const sentences = [];
    const baseDepth = config.depth || 10.0;
    const baseWindSpeed = config.windSpeed || 15.0;
    const baseWindAngle = config.windAngle || 45.0;

    for (let i = 0; i < count; i++) {
      // Depth
      const depth = baseDepth + (Math.random() - 0.5) * 2;
      const dbt = `$SDDBT,${(depth * 3.28084).toFixed(1)},f,${depth.toFixed(1)},M,${(depth * 0.546807).toFixed(1)},F`;
      sentences.push(this.addChecksum(dbt));

      // Apparent wind
      const windSpeed = baseWindSpeed + (Math.random() - 0.5) * 5;
      const windAngle = baseWindAngle + (Math.random() - 0.5) * 20;
      const mwvR = `$WIMWV,${windAngle.toFixed(1)},R,${windSpeed.toFixed(1)},M,A`;
      sentences.push(this.addChecksum(mwvR));

      // True wind every 3rd
      if (i % 3 === 0) {
        const mwvT = `$WIMWV,${(windAngle + 10).toFixed(1)},T,${(windSpeed * 0.9).toFixed(1)},M,A`;
        sentences.push(this.addChecksum(mwvT));
      }

      // Temperature every 10th
      if (i % 10 === 0) {
        const temp = 20 + Math.random() * 5;
        const xdr = `$YXXDR,C,${temp.toFixed(1)},C,TEMP`;
        sentences.push(this.addChecksum(xdr));
      }
    }

    return sentences;
  }

  /**
   * Generate AIS NMEA sentences (simplified)
   */
  generateAisBurst(count, config = {}) {
    // These are sample real AIS messages - in production you'd generate proper encoded AIS
    const sampleAis = [
      '!AIVDM,1,1,,A,13u@DP0P00PlJ`<5;:0?4?v00000,0*39',
      '!AIVDM,1,1,,B,15MgK70000JsHG8Hus0FbD:0000,0*61',
      '!AIVDM,1,1,,A,15N4cJ`005Jrek0H@9n`DW5608EP,0*13',
      '!AIVDM,1,1,,B,13HOI:0P00PlRG0Hch2rP?v@0D02,0*4A',
      '!AIVDM,1,1,,A,14eGrSiP00PlhH@HUBD0v?v@0<0g,0*74',
    ];

    const sentences = [];
    for (let i = 0; i < count; i++) {
      sentences.push(sampleAis[i % sampleAis.length]);
    }
    return sentences;
  }

  /**
   * Calculate and add NMEA checksum
   */
  addChecksum(sentence) {
    // Remove any existing checksum
    const base = sentence.split('*')[0];
    // Remove leading $ or !
    const data = base.substring(1);
    
    let checksum = 0;
    for (let i = 0; i < data.length; i++) {
      checksum ^= data.charCodeAt(i);
    }
    
    return `${base}*${checksum.toString(16).toUpperCase().padStart(2, '0')}`;
  }

  /**
   * Validate NMEA checksum
   */
  validateChecksum(sentence) {
    if (!sentence.includes('*')) return false;

    const [data, providedChecksum] = sentence.split('*');
    const content = data.substring(1); // Remove $ or !

    let calculated = 0;
    for (let i = 0; i < content.length; i++) {
      calculated ^= content.charCodeAt(i);
    }

    return calculated.toString(16).toUpperCase().padStart(2, '0') === providedChecksum.toUpperCase();
  }

  /**
   * Send realistic test data from nmea0183_test.txt file via TCP
   */
  async sendTestDataTcp(options = {}) {
    const sentences = NmeaFixtures.getAllTestSentences();
    return this.sendTcp(sentences, options);
  }

  /**
   * Send realistic test data from nmea0183_test.txt file via UDP
   */
  async sendTestDataUdp(options = {}) {
    const sentences = NmeaFixtures.getAllTestSentences();
    return this.sendUdp(sentences, options);
  }

  /**
   * Get navigation sentences from test data
   */
  getTestNavigationSentences() {
    return NmeaFixtures.getNavigationSentences();
  }

  /**
   * Get AIS sentences from test data
   */
  getTestAisSentences() {
    return NmeaFixtures.getAisSentences();
  }

  /**
   * Get a burst of realistic test data (repeats to reach count)
   */
  getTestDataBurst(count = 100) {
    return NmeaFixtures.getTestDataBurst(count);
  }

  /**
   * Get sentences by type from test data
   */
  getTestSentencesByType(type) {
    return NmeaFixtures.getSentencesByType(type);
  }
}

module.exports = { NmeaFeeder };
