/**
 * NmeaFixtures - NMEA 0183 sentence generators and test data loader
 *
 * Provides functions to generate valid NMEA sentences for testing
 * and load realistic test data from file
 */

const fs = require('fs');
const path = require('path');

class NmeaFixtures {
  static testDataPath = path.join(__dirname, '..', 'tests', 'nmea0183_test.txt');
  static cachedSentences = null;

  /**
   * Load sentences from test data file
   */
  static loadTestData() {
    if (this.cachedSentences) {
      return this.cachedSentences;
    }

    if (!fs.existsSync(this.testDataPath)) {
      console.warn(`Test data file not found: ${this.testDataPath}`);
      return [];
    }

    const content = fs.readFileSync(this.testDataPath, 'utf-8');
    this.cachedSentences = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('$') || line.startsWith('!'));

    return this.cachedSentences;
  }

  /**
   * Get all sentences from test file
   */
  static getAllTestSentences() {
    return this.loadTestData();
  }

  /**
   * Get sentences by type prefix (e.g., 'GGA', 'RMC', 'VDM')
   */
  static getSentencesByType(type) {
    return this.loadTestData().filter(s => s.includes(type));
  }

  /**
   * Get navigation sentences (GGA, RMC, VTG, HDT, GLL)
   */
  static getNavigationSentences() {
    const navTypes = ['GGA', 'RMC', 'VTG', 'HDT', 'GLL', 'GNS'];
    return this.loadTestData().filter(s =>
      navTypes.some(type => s.includes(type))
    );
  }

  /**
   * Get satellite info sentences (GSA, GSV)
   */
  static getSatelliteSentences() {
    return this.loadTestData().filter(s =>
      s.includes('GSA') || s.includes('GSV')
    );
  }

  /**
   * Get AIS sentences (VDM, VDO)
   */
  static getAisSentences() {
    return this.loadTestData().filter(s =>
      s.startsWith('!AI')
    );
  }

  /**
   * Get a burst of realistic test sentences for stress testing
   * Repeats the test data to reach desired count
   */
  static getTestDataBurst(count = 100) {
    const sentences = this.loadTestData();
    if (sentences.length === 0) {
      return this.generateNavigationBurst(60.0, 24.0, count);
    }

    const result = [];
    for (let i = 0; i < count; i++) {
      result.push(sentences[i % sentences.length]);
    }
    return result;
  }
  /**
   * Calculate NMEA checksum
   */
  static checksum(sentence) {
    let sum = 0;
    for (let i = 1; i < sentence.length; i++) {
      sum ^= sentence.charCodeAt(i);
    }
    return sum.toString(16).toUpperCase().padStart(2, '0');
  }

  /**
   * Add checksum to sentence
   */
  static addChecksum(sentence) {
    const cs = this.checksum(sentence);
    return `${sentence}*${cs}`;
  }

  /**
   * Generate RMC sentence (Recommended Minimum Navigation)
   */
  static generateRMC(lat = 60.0, lon = 24.0, speed = 5.5, course = 45.0) {
    const time = new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .slice(8, 14);
    const date = new Date()
      .toISOString()
      .slice(0, 10)
      .replace(/-/g, '')
      .slice(2);

    const latDeg = Math.floor(Math.abs(lat));
    const latMin = (Math.abs(lat) - latDeg) * 60;
    const latStr = `${latDeg.toString().padStart(2, '0')}${latMin.toFixed(3).padStart(6, '0')}`;
    const latDir = lat >= 0 ? 'N' : 'S';

    const lonDeg = Math.floor(Math.abs(lon));
    const lonMin = (Math.abs(lon) - lonDeg) * 60;
    const lonStr = `${lonDeg.toString().padStart(3, '0')}${lonMin.toFixed(3).padStart(6, '0')}`;
    const lonDir = lon >= 0 ? 'E' : 'W';

    const sentence = `$GPRMC,${time},A,${latStr},${latDir},${lonStr},${lonDir},${speed.toFixed(1)},${course.toFixed(1)},${date},0.0,E,A`;
    return this.addChecksum(sentence);
  }

  /**
   * Generate GGA sentence (GPS Fix Data)
   */
  static generateGGA(lat = 60.0, lon = 24.0, altitude = 10.0) {
    const time = new Date()
      .toISOString()
      .replace(/[-:T]/g, '')
      .slice(8, 14);

    const latDeg = Math.floor(Math.abs(lat));
    const latMin = (Math.abs(lat) - latDeg) * 60;
    const latStr = `${latDeg.toString().padStart(2, '0')}${latMin.toFixed(3).padStart(6, '0')}`;
    const latDir = lat >= 0 ? 'N' : 'S';

    const lonDeg = Math.floor(Math.abs(lon));
    const lonMin = (Math.abs(lon) - lonDeg) * 60;
    const lonStr = `${lonDeg.toString().padStart(3, '0')}${lonMin.toFixed(3).padStart(6, '0')}`;
    const lonDir = lon >= 0 ? 'E' : 'W';

    const sentence = `$GPGGA,${time},${latStr},${latDir},${lonStr},${lonDir},1,08,0.9,${altitude.toFixed(1)},M,0.0,M,,`;
    return this.addChecksum(sentence);
  }

  /**
   * Generate DBT sentence (Depth Below Transducer)
   */
  static generateDBT(depthMeters = 10.0) {
    const depthFeet = depthMeters * 3.28084;
    const depthFathoms = depthMeters * 0.546807;
    const sentence = `$SDDBT,${depthFeet.toFixed(1)},f,${depthMeters.toFixed(1)},M,${depthFathoms.toFixed(1)},F`;
    return this.addChecksum(sentence);
  }

  /**
   * Generate MWV sentence (Wind Speed and Angle)
   */
  static generateMWV(angle = 270, speed = 15.0, reference = 'R') {
    const sentence = `$WIMWV,${angle.toFixed(1)},${reference},${speed.toFixed(1)},M,A`;
    return this.addChecksum(sentence);
  }

  /**
   * Generate HDT sentence (Heading True)
   */
  static generateHDT(heading = 125.5) {
    const sentence = `$HEHDT,${heading.toFixed(1)},T`;
    return this.addChecksum(sentence);
  }

  /**
   * Generate VTG sentence (Track and Ground Speed)
   */
  static generateVTG(course = 45.0, speedKnots = 5.5) {
    const speedKmh = speedKnots * 1.852;
    const sentence = `$GPVTG,${course.toFixed(1)},T,${course.toFixed(1)},M,${speedKnots.toFixed(1)},N,${speedKmh.toFixed(1)},K,A`;
    return this.addChecksum(sentence);
  }

  /**
   * Generate MTW sentence (Water Temperature)
   */
  static generateMTW(tempCelsius = 18.5) {
    const sentence = `$SDMTW,${tempCelsius.toFixed(1)},C`;
    return this.addChecksum(sentence);
  }

  /**
   * Generate a burst of navigation sentences
   */
  static generateNavigationBurst(lat = 60.0, lon = 24.0, count = 10) {
    const sentences = [];
    for (let i = 0; i < count; i++) {
      const offsetLat = lat + i * 0.001;
      const offsetLon = lon + i * 0.001;
      sentences.push(this.generateRMC(offsetLat, offsetLon, 5.5, 45.0));
      sentences.push(this.generateGGA(offsetLat, offsetLon, 10.0));
      sentences.push(this.generateDBT(10.5));
      sentences.push(this.generateMWV(270, 15.0));
    }
    return sentences;
  }
}

module.exports = { NmeaFixtures };
