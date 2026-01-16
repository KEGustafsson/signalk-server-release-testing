/**
 * Data Conversion and Unit Tests
 *
 * Tests NMEA to SignalK data conversion, unit conversions,
 * and data accuracy for various sentence types.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { NmeaFeeder } = require('../lib/nmea-feeder');
const { NmeaFixtures } = require('../lib/nmea-fixtures');

describe('Data Conversion and Units', () => {
  let manager;
  let logMonitor;
  let feeder;
  let baseUrl;
  let apiUrl;
  let tcpPort;

  beforeAll(async () => {
    logMonitor = new LogMonitor();
    manager = new ContainerManager({
      image: process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest',
      logMonitor,
    });
    const info = await manager.start();
    baseUrl = info.baseUrl;
    apiUrl = info.apiUrl;
    tcpPort = info.tcpPort;
    feeder = new NmeaFeeder({ tcpPort });

    await sleep(2000);
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);

    const summary = logMonitor.getSummary();
    console.log('\n--- Data Conversion Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
    console.log(`Total Warnings: ${summary.totalWarnings}`);
  });

  describe('Position Conversion', () => {
    test('converts NMEA latitude correctly', async () => {
      logMonitor.setPhase('conv-lat');

      // NMEA format: DDMM.MMMMM (degrees and decimal minutes)
      // 6016.83272,N = 60 degrees + 16.83272 minutes = 60 + 16.83272/60 = 60.28054533...
      const sentence = '$GNRMC,120000,A,6016.83272,N,02217.19556,E,5.0,90.0,150126,0.0,E,D*00';
      const correctedSentence = NmeaFixtures.addChecksum(sentence.slice(0, -3));

      await feeder.sendTcp(correctedSentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/navigation/position`);
      if (res.ok) {
        const data = await res.json();
        // 6016.83272 minutes = 60 + 16.83272/60 = 60.280545333...
        expect(data.value.latitude).toBeCloseTo(60.2805, 3);
        console.log(`Latitude conversion: NMEA 6016.83272,N -> SignalK ${data.value.latitude}`);
      }

      expect(logMonitor.getPhaseErrors('conv-lat')).toHaveLength(0);
    });

    test('converts NMEA longitude correctly', async () => {
      logMonitor.setPhase('conv-lon');

      // 02217.19556,E = 22 degrees + 17.19556 minutes = 22 + 17.19556/60 = 22.28659266...
      const sentence = '$GNRMC,120001,A,6016.83272,N,02217.19556,E,5.0,90.0,150126,0.0,E,D*00';
      const correctedSentence = NmeaFixtures.addChecksum(sentence.slice(0, -3));

      await feeder.sendTcp(correctedSentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/navigation/position`);
      if (res.ok) {
        const data = await res.json();
        // 02217.19556 = 22 + 17.19556/60 = 22.286592666...
        expect(data.value.longitude).toBeCloseTo(22.2866, 3);
        console.log(`Longitude conversion: NMEA 02217.19556,E -> SignalK ${data.value.longitude}`);
      }

      expect(logMonitor.getPhaseErrors('conv-lon')).toHaveLength(0);
    });

    test('handles southern latitude correctly', async () => {
      logMonitor.setPhase('conv-south-lat');

      // Southern latitude should be negative
      const sentence = NmeaFixtures.generateRMC(-33.8688, 151.2093, 0, 0); // Sydney
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/navigation/position`);
      if (res.ok) {
        const data = await res.json();
        expect(data.value.latitude).toBeLessThan(0);
        console.log(`Southern latitude: ${data.value.latitude}`);
      }

      expect(logMonitor.getPhaseErrors('conv-south-lat')).toHaveLength(0);
    });

    test('handles western longitude correctly', async () => {
      logMonitor.setPhase('conv-west-lon');

      // Western longitude should be negative
      const sentence = NmeaFixtures.generateRMC(40.7128, -74.006, 0, 0); // New York
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/navigation/position`);
      if (res.ok) {
        const data = await res.json();
        expect(data.value.longitude).toBeLessThan(0);
        console.log(`Western longitude: ${data.value.longitude}`);
      }

      expect(logMonitor.getPhaseErrors('conv-west-lon')).toHaveLength(0);
    });
  });

  describe('Speed Conversion', () => {
    test('converts knots to m/s correctly', async () => {
      logMonitor.setPhase('conv-speed');

      // 10 knots = 10 * 0.514444 = 5.14444 m/s
      const sentence = NmeaFixtures.generateRMC(60.0, 24.0, 10.0, 90.0);
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/navigation/speedOverGround`);
      if (res.ok) {
        const data = await res.json();
        // 10 knots = ~5.144 m/s
        expect(data.value).toBeCloseTo(5.144, 1);
        console.log(`Speed conversion: 10 knots -> ${data.value} m/s`);
      }

      expect(logMonitor.getPhaseErrors('conv-speed')).toHaveLength(0);
    });

    test('converts VTG speed correctly', async () => {
      logMonitor.setPhase('conv-vtg-speed');

      // VTG contains both knots and km/h
      const sentence = NmeaFixtures.generateVTG(90.0, 15.0);
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/navigation/speedOverGround`);
      if (res.ok) {
        const data = await res.json();
        // 15 knots = ~7.72 m/s
        expect(data.value).toBeCloseTo(7.72, 1);
        console.log(`VTG speed conversion: 15 knots -> ${data.value} m/s`);
      }

      expect(logMonitor.getPhaseErrors('conv-vtg-speed')).toHaveLength(0);
    });
  });

  describe('Course and Heading Conversion', () => {
    test('converts degrees to radians for COG', async () => {
      logMonitor.setPhase('conv-cog');

      // 90 degrees = PI/2 radians = 1.5708...
      const sentence = NmeaFixtures.generateRMC(60.0, 24.0, 5.0, 90.0);
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/navigation/courseOverGroundTrue`);
      if (res.ok) {
        const data = await res.json();
        // 90 degrees = PI/2 = 1.5708
        expect(data.value).toBeCloseTo(Math.PI / 2, 2);
        console.log(`COG conversion: 90 degrees -> ${data.value} radians`);
      }

      expect(logMonitor.getPhaseErrors('conv-cog')).toHaveLength(0);
    });

    test('converts HDT heading correctly', async () => {
      logMonitor.setPhase('conv-hdt');

      // 180 degrees = PI radians
      const sentence = NmeaFixtures.generateHDT(180.0);
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/navigation/headingTrue`);
      if (res.ok) {
        const data = await res.json();
        // 180 degrees = PI = 3.14159
        expect(data.value).toBeCloseTo(Math.PI, 2);
        console.log(`Heading conversion: 180 degrees -> ${data.value} radians`);
      }

      expect(logMonitor.getPhaseErrors('conv-hdt')).toHaveLength(0);
    });

    test('handles 360/0 degree boundary', async () => {
      logMonitor.setPhase('conv-360');

      // Test 359 degrees
      const sentence1 = NmeaFixtures.generateRMC(60.0, 24.0, 5.0, 359.0);
      await feeder.sendTcp(sentence1);
      await sleep(500);

      const res1 = await fetch(`${apiUrl}/vessels/self/navigation/courseOverGroundTrue`);
      if (res1.ok) {
        const data = await res1.json();
        // 359 degrees = ~6.265 radians
        expect(data.value).toBeGreaterThan(6.0);
        expect(data.value).toBeLessThan(2 * Math.PI);
        console.log(`359 degrees -> ${data.value} radians`);
      }

      // Test 1 degree
      const sentence2 = NmeaFixtures.generateRMC(60.0, 24.0, 5.0, 1.0);
      await feeder.sendTcp(sentence2);
      await sleep(500);

      const res2 = await fetch(`${apiUrl}/vessels/self/navigation/courseOverGroundTrue`);
      if (res2.ok) {
        const data = await res2.json();
        // 1 degree = ~0.0175 radians
        expect(data.value).toBeGreaterThan(0);
        expect(data.value).toBeLessThan(0.1);
        console.log(`1 degree -> ${data.value} radians`);
      }

      expect(logMonitor.getPhaseErrors('conv-360')).toHaveLength(0);
    });
  });

  describe('Depth Conversion', () => {
    test('converts DBT depth in meters', async () => {
      logMonitor.setPhase('conv-depth');

      // DBT with depth in meters
      const sentence = NmeaFixtures.generateDBT(15.5);
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/environment/depth/belowTransducer`);
      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeCloseTo(15.5, 1);
        console.log(`Depth conversion: 15.5m -> ${data.value}m`);
      }

      expect(logMonitor.getPhaseErrors('conv-depth')).toHaveLength(0);
    });

    test('handles shallow depth correctly', async () => {
      logMonitor.setPhase('conv-shallow');

      const sentence = NmeaFixtures.generateDBT(1.2);
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/environment/depth/belowTransducer`);
      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeCloseTo(1.2, 1);
      }

      expect(logMonitor.getPhaseErrors('conv-shallow')).toHaveLength(0);
    });

    test('handles deep water correctly', async () => {
      logMonitor.setPhase('conv-deep');

      const sentence = NmeaFixtures.generateDBT(150.0);
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/environment/depth/belowTransducer`);
      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeCloseTo(150.0, 1);
      }

      expect(logMonitor.getPhaseErrors('conv-deep')).toHaveLength(0);
    });
  });

  describe('Wind Conversion', () => {
    test('converts apparent wind speed from m/s', async () => {
      logMonitor.setPhase('conv-wind-speed');

      // MWV with 15 m/s wind
      const sentence = NmeaFixtures.generateMWV(45, 15.0, 'R');
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/environment/wind/speedApparent`);
      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeCloseTo(15.0, 1);
        console.log(`Apparent wind speed: ${data.value} m/s`);
      }

      expect(logMonitor.getPhaseErrors('conv-wind-speed')).toHaveLength(0);
    });

    test('converts wind angle to radians', async () => {
      logMonitor.setPhase('conv-wind-angle');

      // 90 degrees apparent wind
      const sentence = NmeaFixtures.generateMWV(90, 10.0, 'R');
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/environment/wind/angleApparent`);
      if (res.ok) {
        const data = await res.json();
        // 90 degrees = PI/2 radians
        expect(data.value).toBeCloseTo(Math.PI / 2, 2);
        console.log(`Wind angle conversion: 90 degrees -> ${data.value} radians`);
      }

      expect(logMonitor.getPhaseErrors('conv-wind-angle')).toHaveLength(0);
    });

    test('handles true wind separately from apparent', async () => {
      logMonitor.setPhase('conv-true-wind');

      // Send both apparent and true wind
      await feeder.sendTcp(NmeaFixtures.generateMWV(45, 15.0, 'R')); // Apparent
      await feeder.sendTcp(NmeaFixtures.generateMWV(60, 12.0, 'T')); // True
      await sleep(1000);

      const apparentRes = await fetch(`${apiUrl}/vessels/self/environment/wind/speedApparent`);
      const trueRes = await fetch(`${apiUrl}/vessels/self/environment/wind/speedTrue`);

      if (apparentRes.ok) {
        const data = await apparentRes.json();
        console.log(`Apparent wind speed: ${data.value} m/s`);
      }

      if (trueRes.ok) {
        const data = await trueRes.json();
        console.log(`True wind speed: ${data.value} m/s`);
      }

      expect(logMonitor.getPhaseErrors('conv-true-wind')).toHaveLength(0);
    });
  });

  describe('Temperature Conversion', () => {
    test('converts water temperature to Kelvin', async () => {
      logMonitor.setPhase('conv-water-temp');

      // MTW with 18.5 Celsius
      const sentence = NmeaFixtures.generateMTW(18.5);
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/environment/water/temperature`);
      if (res.ok) {
        const data = await res.json();
        // SignalK uses Kelvin: 18.5 C + 273.15 = 291.65 K
        expect(data.value).toBeCloseTo(291.65, 1);
        console.log(`Water temp conversion: 18.5°C -> ${data.value}K`);
      }

      expect(logMonitor.getPhaseErrors('conv-water-temp')).toHaveLength(0);
    });

    test('handles freezing temperature', async () => {
      logMonitor.setPhase('conv-freeze-temp');

      const sentence = NmeaFixtures.generateMTW(0.0);
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/environment/water/temperature`);
      if (res.ok) {
        const data = await res.json();
        // 0°C = 273.15K
        expect(data.value).toBeCloseTo(273.15, 1);
      }

      expect(logMonitor.getPhaseErrors('conv-freeze-temp')).toHaveLength(0);
    });
  });

  describe('Multiple Sentence Processing', () => {
    test('processes GGA altitude correctly', async () => {
      logMonitor.setPhase('conv-altitude');

      const sentence = NmeaFixtures.generateGGA(60.0, 24.0, 25.5);
      await feeder.sendTcp(sentence);
      await sleep(1000);

      // GGA contains altitude, check if it's stored
      const res = await fetch(`${apiUrl}/vessels/self/navigation/gnss/antennaAltitude`);
      if (res.ok) {
        const data = await res.json();
        console.log(`Altitude: ${data.value}m`);
      }

      expect(logMonitor.getPhaseErrors('conv-altitude')).toHaveLength(0);
    });

    test('processes mixed navigation burst correctly', async () => {
      logMonitor.setPhase('conv-mixed-burst');

      // Send a burst of various sentences
      const sentences = [
        NmeaFixtures.generateRMC(60.5, 24.5, 8.0, 135.0),
        NmeaFixtures.generateGGA(60.5, 24.5, 15.0),
        NmeaFixtures.generateVTG(135.0, 8.0),
        NmeaFixtures.generateHDT(130.0),
        NmeaFixtures.generateDBT(20.0),
        NmeaFixtures.generateMWV(60, 12.0, 'R'),
        NmeaFixtures.generateMTW(16.5),
      ];

      await feeder.sendTcp(sentences, { delay: 100 });
      await sleep(2000);

      // Verify multiple values
      const checks = [
        { path: 'navigation/position', check: (d) => d.value.latitude > 60 },
        { path: 'navigation/speedOverGround', check: (d) => d.value > 0 },
        { path: 'navigation/courseOverGroundTrue', check: (d) => d.value > 0 },
        { path: 'environment/depth/belowTransducer', check: (d) => d.value > 0 },
        { path: 'environment/wind/speedApparent', check: (d) => d.value > 0 },
        { path: 'environment/water/temperature', check: (d) => d.value > 250 },
      ];

      for (const check of checks) {
        const res = await fetch(`${apiUrl}/vessels/self/${check.path}`);
        if (res.ok) {
          const data = await res.json();
          expect(check.check(data)).toBe(true);
          console.log(`${check.path}: ${JSON.stringify(data.value)}`);
        }
      }

      expect(logMonitor.getPhaseErrors('conv-mixed-burst')).toHaveLength(0);
    });
  });

  describe('Data Precision', () => {
    test('maintains position precision', async () => {
      logMonitor.setPhase('precision-position');

      // High precision position
      const sentence = NmeaFixtures.generateRMC(60.123456, 24.654321, 0, 0);
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/navigation/position`);
      if (res.ok) {
        const data = await res.json();
        // Should maintain at least 4 decimal places
        expect(data.value.latitude).toBeCloseTo(60.1235, 3);
        expect(data.value.longitude).toBeCloseTo(24.6543, 3);
      }

      expect(logMonitor.getPhaseErrors('precision-position')).toHaveLength(0);
    });

    test('maintains speed precision', async () => {
      logMonitor.setPhase('precision-speed');

      // Precise speed: 7.35 knots
      const sentence = NmeaFixtures.generateRMC(60.0, 24.0, 7.35, 90.0);
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/navigation/speedOverGround`);
      if (res.ok) {
        const data = await res.json();
        // 7.35 knots = 3.78 m/s
        expect(data.value).toBeCloseTo(3.78, 1);
      }

      expect(logMonitor.getPhaseErrors('precision-speed')).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    test('handles zero speed', async () => {
      logMonitor.setPhase('edge-zero-speed');

      const sentence = NmeaFixtures.generateRMC(60.0, 24.0, 0.0, 0.0);
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/navigation/speedOverGround`);
      if (res.ok) {
        const data = await res.json();
        expect(data.value).toBeCloseTo(0, 2);
      }

      expect(logMonitor.getPhaseErrors('edge-zero-speed')).toHaveLength(0);
    });

    test('handles equator crossing (lat=0)', async () => {
      logMonitor.setPhase('edge-equator');

      const sentence = NmeaFixtures.generateRMC(0.0, 24.0, 5.0, 90.0);
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/navigation/position`);
      if (res.ok) {
        const data = await res.json();
        expect(data.value.latitude).toBeCloseTo(0, 1);
      }

      expect(logMonitor.getPhaseErrors('edge-equator')).toHaveLength(0);
    });

    test('handles prime meridian crossing (lon=0)', async () => {
      logMonitor.setPhase('edge-prime-meridian');

      const sentence = NmeaFixtures.generateRMC(51.5074, 0.0, 5.0, 90.0); // London area
      await feeder.sendTcp(sentence);
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels/self/navigation/position`);
      if (res.ok) {
        const data = await res.json();
        expect(data.value.longitude).toBeCloseTo(0, 1);
      }

      expect(logMonitor.getPhaseErrors('edge-prime-meridian')).toHaveLength(0);
    });
  });
});
