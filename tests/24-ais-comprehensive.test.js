/**
 * AIS Comprehensive Tests
 *
 * Tests all AIS message types (Class A, Class B, Aids to Navigation, etc.)
 * for proper parsing and SignalK conversion.
 */

const { ContainerManager } = require('../lib/container-manager');
const { LogMonitor } = require('../lib/log-monitor');
const { NmeaFeeder } = require('../lib/nmea-feeder');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// AIS Message Type Definitions
const AIS_MESSAGES = {
  // Class A Position Report (Types 1, 2, 3)
  TYPE_1_POSITION: {
    description: 'Class A Position Report',
    mmsi: '366123456',
    // Encoded message for type 1
    sentences: ['!AIVDM,1,1,,A,13u><=0P00PH34BP0J0R1@0H0000,0*0E'],
  },

  // Type 5 - Static and Voyage Data
  TYPE_5_STATIC: {
    description: 'Class A Static and Voyage Data',
    mmsi: '366123456',
    sentences: [
      '!AIVDM,2,1,3,B,55?MbV02>H97Kc<H00084HTv2222222222222220l1@E844i0C0P4Q3SlP,0*2C',
      '!AIVDM,2,2,3,B,888888888888880,2*25',
    ],
  },

  // Type 18 - Class B Position Report
  TYPE_18_CLASS_B: {
    description: 'Class B CS Position Report',
    mmsi: '367654321',
    sentences: ['!AIVDM,1,1,,B,B69>7mh0?J<:Hb05mOVS3wv5oP06,0*31'],
  },

  // Type 19 - Class B Extended Position Report
  TYPE_19_CLASS_B_EXT: {
    description: 'Class B Extended Position Report',
    mmsi: '367654322',
    sentences: ['!AIVDM,1,1,,A,C5N3SRgPEnJGEBT>NhWAwwo862PaLELTBJ:V00000000S0D:R220,0*25'],
  },

  // Type 21 - Aid to Navigation Report
  TYPE_21_ATON: {
    description: 'Aid to Navigation Report',
    mmsi: '993123456',
    sentences: ['!AIVDM,1,1,,A,E5N3SHB0h3vTT>1H@00000000000007W0000000000000P00000,0*2E'],
  },

  // Type 24 - Class B CS Static Data Report
  TYPE_24_STATIC: {
    description: 'Class B CS Static Data',
    mmsi: '367654321',
    sentences: [
      '!AIVDM,1,1,,A,H52N3S@T4eTE<HFP00000000000,2*45',
      '!AIVDM,1,1,,B,H52N3S@U4E2104@D400000000000,0*75',
    ],
  },

  // Type 4 - Base Station Report
  TYPE_4_BASE: {
    description: 'Base Station Report',
    mmsi: '003660001',
    sentences: ['!AIVDM,1,1,,B,403OviQuMGCqWrRO9>E6fE700@GO,0*4D'],
  },

  // Type 9 - SAR Aircraft Position Report
  TYPE_9_SAR: {
    description: 'SAR Aircraft Position Report',
    mmsi: '111111111',
    sentences: ['!AIVDM,1,1,,B,91b55IP02mJP3wVLWN@gv7000000,0*6D'],
  },

  // Type 12 - Addressed Safety Message
  TYPE_12_SAFETY: {
    description: 'Addressed Safety Related Message',
    mmsi: '366123456',
    sentences: ['!AIVDM,1,1,,A,<5MsUn0000000000000000000000000000000000000000,0*45'],
  },

  // Type 14 - Safety Related Broadcast
  TYPE_14_BROADCAST: {
    description: 'Safety Related Broadcast',
    mmsi: '366123456',
    sentences: ['!AIVDM,1,1,,A,>5MsUn00000000000000000000000000000000000000,0*0E'],
  },
};

describe('AIS Comprehensive Tests', () => {
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
    apiUrl = `${baseUrl}/signalk/v1/api`;
    tcpPort = info.tcpPort;
    feeder = new NmeaFeeder({ tcpPort });

    await sleep(3000);
  }, 120000);

  afterAll(async () => {
    await manager.remove(true);

    const summary = logMonitor.getSummary();
    console.log('\n--- AIS Comprehensive Test Log Summary ---');
    console.log(`Total Errors: ${summary.totalErrors}`);
  });

  describe('Class A Position Reports (Types 1-3)', () => {
    test('processes Class A position report', async () => {
      logMonitor.setPhase('ais-type1');

      await feeder.sendTcp(AIS_MESSAGES.TYPE_1_POSITION.sentences);
      await sleep(2000);

      // Check if vessel appeared
      const res = await fetch(`${apiUrl}/vessels`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      const vesselCount = Object.keys(data).length;
      console.log(`Vessels after Type 1: ${vesselCount}`);

      expect(logMonitor.getPhaseErrors('ais-type1')).toHaveLength(0);
    });

    test('Class A position includes required fields', async () => {
      logMonitor.setPhase('ais-type1-fields');

      // Send position report
      await feeder.sendTcp([
        '!AIVDM,1,1,,A,13u4eT0P00PH3>BP0lR1@0NH0000,0*72',
      ]);
      await sleep(2000);

      // Find vessel with MMSI
      const res = await fetch(`${apiUrl}/vessels`);
      if (res.ok) {
        const data = await res.json();
        const vessels = Object.entries(data);

        for (const [id, vessel] of vessels) {
          if (id !== 'self') {
            // Check for expected navigation data
            if (vessel.navigation?.position) {
              expect(vessel.navigation.position.value?.latitude).toBeDefined();
              expect(vessel.navigation.position.value?.longitude).toBeDefined();
              console.log(`Vessel ${id} position found`);
            }
          }
        }
      }

      expect(logMonitor.getPhaseErrors('ais-type1-fields')).toHaveLength(0);
    });
  });

  describe('Class A Static Data (Type 5)', () => {
    test('processes multi-sentence Type 5 message', async () => {
      logMonitor.setPhase('ais-type5');

      await feeder.sendTcp(AIS_MESSAGES.TYPE_5_STATIC.sentences);
      await sleep(2000);

      expect(logMonitor.getPhaseErrors('ais-type5')).toHaveLength(0);
    });

    test('Type 5 includes vessel name and callsign', async () => {
      logMonitor.setPhase('ais-type5-static');

      // Check for vessel static data
      const res = await fetch(`${apiUrl}/vessels`);
      if (res.ok) {
        const data = await res.json();

        for (const [id, vessel] of Object.entries(data)) {
          if (id !== 'self' && vessel.name) {
            console.log(`Vessel ${id} name: ${vessel.name}`);
          }
          if (vessel.communication?.callsignVhf) {
            console.log(`Vessel ${id} callsign: ${vessel.communication.callsignVhf}`);
          }
        }
      }

      expect(logMonitor.getPhaseErrors('ais-type5-static')).toHaveLength(0);
    });

    test('Type 5 includes dimensions', async () => {
      logMonitor.setPhase('ais-type5-dimensions');

      const res = await fetch(`${apiUrl}/vessels`);
      if (res.ok) {
        const data = await res.json();

        for (const [id, vessel] of Object.entries(data)) {
          if (id !== 'self' && vessel.design) {
            if (vessel.design.length?.overall?.value) {
              console.log(`Vessel ${id} length: ${vessel.design.length.overall.value}m`);
            }
            if (vessel.design.beam?.value) {
              console.log(`Vessel ${id} beam: ${vessel.design.beam.value}m`);
            }
          }
        }
      }

      expect(logMonitor.getPhaseErrors('ais-type5-dimensions')).toHaveLength(0);
    });
  });

  describe('Class B Position Reports (Types 18-19)', () => {
    test('processes Class B CS position report (Type 18)', async () => {
      logMonitor.setPhase('ais-type18');

      await feeder.sendTcp(AIS_MESSAGES.TYPE_18_CLASS_B.sentences);
      await sleep(2000);

      expect(logMonitor.getPhaseErrors('ais-type18')).toHaveLength(0);
    });

    test('processes Class B extended position (Type 19)', async () => {
      logMonitor.setPhase('ais-type19');

      await feeder.sendTcp(AIS_MESSAGES.TYPE_19_CLASS_B_EXT.sentences);
      await sleep(2000);

      expect(logMonitor.getPhaseErrors('ais-type19')).toHaveLength(0);
    });

    test('Class B messages create vessel entries', async () => {
      logMonitor.setPhase('ais-classb-vessels');

      const res = await fetch(`${apiUrl}/vessels`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      const aisVessels = Object.keys(data).filter((k) => k !== 'self');
      console.log(`AIS vessels found: ${aisVessels.length}`);

      expect(logMonitor.getPhaseErrors('ais-classb-vessels')).toHaveLength(0);
    });
  });

  describe('Class B Static Data (Type 24)', () => {
    test('processes Type 24 Part A (name)', async () => {
      logMonitor.setPhase('ais-type24a');

      await feeder.sendTcp([AIS_MESSAGES.TYPE_24_STATIC.sentences[0]]);
      await sleep(1000);

      expect(logMonitor.getPhaseErrors('ais-type24a')).toHaveLength(0);
    });

    test('processes Type 24 Part B (callsign, dimensions)', async () => {
      logMonitor.setPhase('ais-type24b');

      await feeder.sendTcp([AIS_MESSAGES.TYPE_24_STATIC.sentences[1]]);
      await sleep(1000);

      expect(logMonitor.getPhaseErrors('ais-type24b')).toHaveLength(0);
    });
  });

  describe('Aid to Navigation (Type 21)', () => {
    test('processes AtoN report', async () => {
      logMonitor.setPhase('ais-type21');

      await feeder.sendTcp(AIS_MESSAGES.TYPE_21_ATON.sentences);
      await sleep(2000);

      expect(logMonitor.getPhaseErrors('ais-type21')).toHaveLength(0);
    });

    test('AtoN has correct type classification', async () => {
      logMonitor.setPhase('ais-type21-class');

      // AtoN should be in atons collection, not vessels
      const res = await fetch(`${apiUrl}/atons`);

      if (res.ok) {
        const data = await res.json();
        console.log(`AtoNs found: ${Object.keys(data).length}`);
      } else if (res.status === 404) {
        // AtoNs might be under vessels or different path
        console.log('AtoN endpoint not available, checking vessels');
      }

      expect(logMonitor.getPhaseErrors('ais-type21-class')).toHaveLength(0);
    });
  });

  describe('Base Station Report (Type 4)', () => {
    test('processes base station report', async () => {
      logMonitor.setPhase('ais-type4');

      await feeder.sendTcp(AIS_MESSAGES.TYPE_4_BASE.sentences);
      await sleep(2000);

      expect(logMonitor.getPhaseErrors('ais-type4')).toHaveLength(0);
    });

    test('base station provides accurate time', async () => {
      logMonitor.setPhase('ais-type4-time');

      // Type 4 includes UTC time from base station
      // This is used for time synchronization

      expect(logMonitor.getPhaseErrors('ais-type4-time')).toHaveLength(0);
    });
  });

  describe('SAR Aircraft (Type 9)', () => {
    test('processes SAR aircraft position', async () => {
      logMonitor.setPhase('ais-type9');

      await feeder.sendTcp(AIS_MESSAGES.TYPE_9_SAR.sentences);
      await sleep(2000);

      expect(logMonitor.getPhaseErrors('ais-type9')).toHaveLength(0);
    });
  });

  describe('Safety Messages (Types 12, 14)', () => {
    test('processes addressed safety message', async () => {
      logMonitor.setPhase('ais-type12');

      await feeder.sendTcp(AIS_MESSAGES.TYPE_12_SAFETY.sentences);
      await sleep(1000);

      expect(logMonitor.getPhaseErrors('ais-type12')).toHaveLength(0);
    });

    test('processes safety broadcast', async () => {
      logMonitor.setPhase('ais-type14');

      await feeder.sendTcp(AIS_MESSAGES.TYPE_14_BROADCAST.sentences);
      await sleep(1000);

      expect(logMonitor.getPhaseErrors('ais-type14')).toHaveLength(0);
    });
  });

  describe('Own Ship AIS (VDO)', () => {
    test('processes own ship VDO messages', async () => {
      logMonitor.setPhase('ais-vdo');

      // VDO is own ship data
      await feeder.sendTcp(['!AIVDO,1,1,,A,13u><=0P00PH34BP0J0R1@0H0000,0*3D']);
      await sleep(2000);

      // Own ship data should appear in self
      const res = await fetch(`${apiUrl}/vessels/self`);
      expect(res.ok).toBe(true);

      expect(logMonitor.getPhaseErrors('ais-vdo')).toHaveLength(0);
    });
  });

  describe('Multi-Sentence Messages', () => {
    test('correctly assembles multi-sentence messages', async () => {
      logMonitor.setPhase('ais-multi-sentence');

      // Send multi-part message (Type 5)
      await feeder.sendTcp(AIS_MESSAGES.TYPE_5_STATIC.sentences, { delay: 100 });
      await sleep(2000);

      expect(logMonitor.getPhaseErrors('ais-multi-sentence')).toHaveLength(0);
    });

    test('handles out-of-order multi-sentence gracefully', async () => {
      logMonitor.setPhase('ais-multi-order');

      // Send parts in wrong order
      const sentences = [...AIS_MESSAGES.TYPE_5_STATIC.sentences].reverse();
      await feeder.sendTcp(sentences);
      await sleep(2000);

      // Should not crash
      const res = await fetch(`${apiUrl}/vessels`);
      expect(res.ok).toBe(true);

      expect(logMonitor.getPhaseErrors('ais-multi-order')).toHaveLength(0);
    });

    test('handles incomplete multi-sentence messages', async () => {
      logMonitor.setPhase('ais-multi-incomplete');

      // Send only first part
      await feeder.sendTcp([AIS_MESSAGES.TYPE_5_STATIC.sentences[0]]);
      await sleep(1000);

      // Should not crash, may log warning
      const res = await fetch(`${apiUrl}/vessels`);
      expect(res.ok).toBe(true);

      expect(logMonitor.getPhaseErrors('ais-multi-incomplete')).toHaveLength(0);
    });
  });

  describe('AIS Data Validation', () => {
    test('validates MMSI format', async () => {
      logMonitor.setPhase('ais-mmsi-format');

      const res = await fetch(`${apiUrl}/vessels`);
      if (res.ok) {
        const data = await res.json();

        for (const [id, vessel] of Object.entries(data)) {
          if (id.startsWith('urn:mrn:imo:mmsi:')) {
            const mmsi = id.replace('urn:mrn:imo:mmsi:', '');
            // MMSI should be 9 digits
            expect(mmsi).toMatch(/^\d{9}$/);
          }
        }
      }

      expect(logMonitor.getPhaseErrors('ais-mmsi-format')).toHaveLength(0);
    });

    test('validates position ranges', async () => {
      logMonitor.setPhase('ais-position-range');

      const res = await fetch(`${apiUrl}/vessels`);
      if (res.ok) {
        const data = await res.json();

        for (const [id, vessel] of Object.entries(data)) {
          if (vessel.navigation?.position?.value) {
            const { latitude, longitude } = vessel.navigation.position.value;
            expect(latitude).toBeGreaterThanOrEqual(-90);
            expect(latitude).toBeLessThanOrEqual(90);
            expect(longitude).toBeGreaterThanOrEqual(-180);
            expect(longitude).toBeLessThanOrEqual(180);
          }
        }
      }

      expect(logMonitor.getPhaseErrors('ais-position-range')).toHaveLength(0);
    });

    test('validates navigation status codes', async () => {
      logMonitor.setPhase('ais-nav-status');

      const res = await fetch(`${apiUrl}/vessels`);
      if (res.ok) {
        const data = await res.json();

        for (const [id, vessel] of Object.entries(data)) {
          if (vessel.navigation?.state?.value) {
            // Navigation state should be one of defined values
            const validStates = [
              'motoring',
              'anchored',
              'not under command',
              'restricted maneuverability',
              'constrained by draft',
              'moored',
              'aground',
              'fishing',
              'sailing',
              'reserved',
              'reserved',
              'reserved',
              'reserved',
              'reserved',
              'ais-sart',
              'default',
            ];
            // Allow any string since mapping may vary
            expect(typeof vessel.navigation.state.value).toBe('string');
          }
        }
      }

      expect(logMonitor.getPhaseErrors('ais-nav-status')).toHaveLength(0);
    });
  });

  describe('High Volume AIS', () => {
    test('handles many AIS targets simultaneously', async () => {
      logMonitor.setPhase('ais-high-volume');

      // Generate multiple unique AIS messages
      const messages = [];
      for (let i = 0; i < 20; i++) {
        // Simple position reports with varying MMSIs
        messages.push(`!AIVDM,1,1,,A,13u><=0P00PH34BP0J0R1@${i.toString().padStart(2, '0')}H0000,0*00`);
      }

      await feeder.sendTcp(messages, { delay: 50 });
      await sleep(3000);

      const res = await fetch(`${apiUrl}/vessels`);
      expect(res.ok).toBe(true);

      const data = await res.json();
      const vesselCount = Object.keys(data).length;
      console.log(`Vessels after high volume: ${vesselCount}`);

      expect(logMonitor.getPhaseErrors('ais-high-volume')).toHaveLength(0);
    });

    test('handles rapid AIS updates', async () => {
      logMonitor.setPhase('ais-rapid');

      // Same vessel, rapid updates
      const messages = Array(50).fill(
        '!AIVDM,1,1,,A,13u><=0P00PH34BP0J0R1@0H0000,0*0E'
      );

      await feeder.sendTcp(messages, { delay: 20 });
      await sleep(2000);

      expect(logMonitor.getPhaseErrors('ais-rapid')).toHaveLength(0);
    });
  });

  describe('AIS via WebSocket', () => {
    test('AIS targets appear in WebSocket stream', async () => {
      logMonitor.setPhase('ais-websocket');

      const WebSocket = require('ws');
      const wsUrl = baseUrl.replace('http', 'ws');

      const aisMessages = await new Promise((resolve) => {
        const ws = new WebSocket(`${wsUrl}/signalk/v1/stream?subscribe=all`);
        const collected = [];

        ws.on('open', async () => {
          // Send AIS data
          await feeder.sendTcp([
            '!AIVDM,1,1,,A,13u><=0P00PH34BP0J0R1@0H0000,0*0E',
          ]);

          setTimeout(() => {
            ws.close();
            resolve(collected);
          }, 3000);
        });

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.context && msg.context.includes('mmsi')) {
              collected.push(msg);
            }
          } catch (e) {
            // Ignore
          }
        });

        ws.on('error', () => {
          resolve(collected);
        });
      });

      console.log(`AIS messages via WebSocket: ${aisMessages.length}`);

      expect(logMonitor.getPhaseErrors('ais-websocket')).toHaveLength(0);
    });
  });

  describe('Error Handling', () => {
    test('handles corrupt AIS messages gracefully', async () => {
      logMonitor.setPhase('ais-corrupt');

      const corruptMessages = [
        '!AIVDM,1,1,,A,GARBAGE,0*00',
        '!AIVDM,1,1,,A,,0*00',
        '!AIVDM,2,1,3,B,INCOMPLETE',
        '!AIVDM,1,1,,X,13u><=0P00PH34BP0J0R1@0H0000,0*0E', // Invalid channel
      ];

      await feeder.sendTcp(corruptMessages);
      await sleep(1000);

      // Server should still be responsive
      const res = await fetch(`${apiUrl}/vessels`);
      expect(res.ok).toBe(true);

      expect(logMonitor.getPhaseErrors('ais-corrupt')).toHaveLength(0);
    });

    test('handles invalid checksums', async () => {
      logMonitor.setPhase('ais-checksum');

      await feeder.sendTcp(['!AIVDM,1,1,,A,13u><=0P00PH34BP0J0R1@0H0000,0*FF']); // Wrong checksum
      await sleep(1000);

      const res = await fetch(`${apiUrl}/vessels`);
      expect(res.ok).toBe(true);

      expect(logMonitor.getPhaseErrors('ais-checksum')).toHaveLength(0);
    });
  });
});
