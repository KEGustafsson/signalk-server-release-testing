/**
 * ContainerManager - Docker container lifecycle management
 *
 * Manages SignalK server container for testing, including
 * start, stop, restart, and crash simulation.
 */

const Docker = require('dockerode');
const path = require('path');
const fs = require('fs-extra');

class ContainerManager {
  constructor(options = {}) {
    this.docker = new Docker(options.dockerOptions);
    this.image = options.image || process.env.SIGNALK_IMAGE || 'signalk/signalk-server:latest';
    this.container = null;
    this.logMonitor = options.logMonitor;
    this.dataDir = options.dataDir || '/tmp/signalk-test-data-' + Date.now();
    this.containerName = options.containerName || 'signalk-test-' + Date.now();
    
    this.ports = {
      http: options.httpPort || 3000,
      https: options.httpsPort || 3443,
      tcp: options.tcpPort || 10110,
      udp: options.udpPort || 10111,
    };
    
    this.configPath = options.configPath;
    this.startTimeout = options.startTimeout || 60000;
  }

  /**
   * Prepare data directory and configuration
   */
  async prepare() {
    // Create data directory structure
    await fs.ensureDir(this.dataDir);
    await fs.ensureDir(path.join(this.dataDir, 'plugin-config-data'));
    await fs.ensureDir(path.join(this.dataDir, 'logs'));

    // Copy test configuration if provided
    const settingsPath = path.join(this.dataDir, 'settings.json');
    if (this.configPath && await fs.pathExists(this.configPath)) {
      await fs.copy(this.configPath, settingsPath);
    } else {
      // Create minimal default settings with TCP server and UDP providers
      // The built-in nmea-tcp interface creates a TCP server on port 10110 (NMEA0183PORT)
      // providers/tcpserver receives data from that built-in TCP server
      // providers/udp listens for UDP datagrams on the specified port
      const defaultSettings = {
        vessel: {
          name: 'Test Vessel',
          uuid: 'urn:mrn:signalk:uuid:c0d79334-4e25-4245-8892-test-vessel',
        },
        interfaces: {},
        ssl: false,
        security: {
          strategy: "./tokensecurity",
          allowReadToPublic: true,
          allowWriteToPublic: true,
        },
        pipedProviders: [
          {
            id: 'nmea-tcp-input',
            pipeElements: [
              {
                type: 'providers/tcpserver',
              },
              {
                type: 'providers/liner',
              },
              {
                type: 'providers/nmea0183-signalk',
              },
            ],
            enabled: true,
          },
          {
            id: 'nmea-udp-input',
            pipeElements: [
              {
                type: 'providers/udp',
                options: {
                  port: this.ports.udp,
                },
              },
              {
                type: 'providers/nmea0183-signalk',
              },
            ],
            enabled: true,
          },
        ],
      };
      await fs.writeJson(settingsPath, defaultSettings, { spaces: 2 });
    }

    // Create package.json that SignalK server needs
    // SignalK writes to this file during startup for plugin management
    const packageJsonPath = path.join(this.dataDir, 'package.json');
    const packageJson = {
      name: 'signalk-server-config',
      version: '0.0.1',
      description: 'SignalK server configuration',
      dependencies: {},
    };
    await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });

    // Set all permissions at the end to ensure node user can read/write everything
    await fs.chmod(this.dataDir, 0o777);
    await fs.chmod(path.join(this.dataDir, 'plugin-config-data'), 0o777);
    await fs.chmod(path.join(this.dataDir, 'logs'), 0o777);
    await fs.chmod(settingsPath, 0o666);
    await fs.chmod(packageJsonPath, 0o666);
  }

  /**
   * Start the container
   */
  async start(config = {}) {
    this.logMonitor?.setPhase('container-start');

    await this.prepare();

    // Remove existing container with same name if exists
    try {
      const existing = this.docker.getContainer(this.containerName);
      await existing.remove({ force: true });
    } catch (e) {
      // Container doesn't exist, which is fine
    }

    const containerConfig = {
      Image: this.image,
      name: this.containerName,
      Env: [
        'SIGNALK_NODE_SETTINGS=/home/node/.signalk/settings.json',
        `NMEA0183PORT=${this.ports.tcp}`,
        ...(config.env || []),
      ],
      ExposedPorts: {
        '3000/tcp': {},
        '3443/tcp': {},
        [`${this.ports.tcp}/tcp`]: {},
        [`${this.ports.udp}/udp`]: {},
      },
      HostConfig: {
        PortBindings: {
          '3000/tcp': [{ HostPort: String(this.ports.http) }],
          '3443/tcp': [{ HostPort: String(this.ports.https) }],
          [`${this.ports.tcp}/tcp`]: [{ HostPort: String(this.ports.tcp) }],
          [`${this.ports.udp}/udp`]: [{ HostPort: String(this.ports.udp) }],
        },
        RestartPolicy: { Name: 'no' },
        NetworkMode: config.networkMode || 'bridge',
      },
      Healthcheck: {
        Test: ['CMD', 'curl', '-f', 'http://localhost:3000/signalk'],
        Interval: 5000000000, // 5 seconds in nanoseconds
        Timeout: 3000000000,
        Retries: 12,
        StartPeriod: 30000000000,
      },
    };

    this.container = await this.docker.createContainer(containerConfig);

    // Attach log monitor before starting
    if (this.logMonitor) {
      await this.logMonitor.attachToContainer(this.container);
    }

    await this.container.start();

    // Copy settings.json into container (avoids Windows permission issues)
    await this.copySettingsToContainer();

    // Restart to pick up the new settings
    await this.container.restart({ t: 5 });

    // Wait for server to be ready
    await this.waitForReady();

    return this.getConnectionInfo();
  }

  /**
   * Copy settings.json into the container
   */
  async copySettingsToContainer() {
    const settingsPath = path.join(this.dataDir, 'settings.json');
    const settings = await fs.readJson(settingsPath);

    // Create a tar archive with the settings.json file
    const tar = require('tar-stream');
    const pack = tar.pack();

    pack.entry({ name: 'settings.json' }, JSON.stringify(settings, null, 2));
    pack.finalize();

    // Collect the tar data into a buffer
    const chunks = [];
    for await (const chunk of pack) {
      chunks.push(chunk);
    }
    const tarBuffer = Buffer.concat(chunks);

    // Put the archive into the container
    await this.container.putArchive(tarBuffer, { path: '/home/node/.signalk' });
  }

  /**
   * Wait for SignalK server to be ready (HTTP + TCP)
   */
  async waitForReady(timeout = null) {
    timeout = timeout || this.startTimeout;
    const start = Date.now();
    const url = `http://localhost:${this.ports.http}/signalk`;

    // First wait for HTTP endpoint
    while (Date.now() - start < timeout) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          if (data.endpoints) {
            // HTTP is ready, now wait for TCP provider
            break;
          }
        }
      } catch (e) {
        // Server not ready yet, continue waiting
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Now wait for TCP port to be listening
    const net = require('net');
    const tcpReady = await this.waitForTcpPort(this.ports.tcp, timeout - (Date.now() - start));
    if (!tcpReady) {
      const status = await this.getStatus();
      const logs = await this.getLogs(500);
      throw new Error(
        `TCP port ${this.ports.tcp} not ready within timeout.\nContainer state: ${JSON.stringify(status)}\nLast logs:\n${logs}`
      );
    }

    return true;
  }

  /**
   * Wait for TCP port to be listening
   */
  async waitForTcpPort(port, timeout = 30000) {
    const net = require('net');
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const connected = await new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(2000);

        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });

        socket.on('error', () => {
          socket.destroy();
          resolve(false);
        });

        socket.on('timeout', () => {
          socket.destroy();
          resolve(false);
        });

        socket.connect(port, 'localhost');
      });

      if (connected) {
        return true;
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    return false;
  }

  /**
   * Stop the container gracefully
   */
  async stop(timeout = 10) {
    this.logMonitor?.setPhase('container-stop');

    if (this.container) {
      const info = await this.container.inspect().catch(() => null);
      if (info?.State?.Running) {
        await this.container.stop({ t: timeout });
      }
    }
  }

  /**
   * Restart the container
   */
  async restart(timeout = 10) {
    this.logMonitor?.setPhase('container-restart');

    if (this.container) {
      await this.container.restart({ t: timeout });
      await this.waitForReady();
    }
  }

  /**
   * Kill the container (simulate crash)
   */
  async kill(signal = 'SIGKILL') {
    this.logMonitor?.setPhase('container-kill');

    if (this.container) {
      await this.container.kill({ signal });
    }
  }

  /**
   * Remove the container and cleanup
   */
  async remove(cleanup = true) {
    if (this.logMonitor) {
      this.logMonitor.detach();
    }

    if (this.container) {
      try {
        const info = await this.container.inspect().catch(() => null);
        if (info?.State?.Running) {
          await this.container.stop({ t: 5 }).catch(() => {});
        }
        await this.container.remove({ force: true });
      } catch (e) {
        // Container might already be removed
      }
    }

    if (cleanup) {
      await fs.remove(this.dataDir).catch(() => {});
    }
  }

  /**
   * Get container logs
   */
  async getLogs(tail = 100) {
    if (!this.container) return '';

    const logs = await this.container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
    });

    // Docker logs are multiplexed with 8-byte headers
    // Strip the headers and return clean log text
    return this.demuxDockerLogs(logs);
  }

  /**
   * Demultiplex Docker log stream
   * Docker prepends an 8-byte header to each log message:
   * - Bytes 0-3: stream type (1=stdout, 2=stderr)
   * - Bytes 4-7: message length (big-endian)
   */
  demuxDockerLogs(buffer) {
    if (!buffer || buffer.length === 0) return '';

    const lines = [];
    let offset = 0;

    while (offset < buffer.length) {
      // Need at least 8 bytes for header
      if (offset + 8 > buffer.length) {
        // Remaining data without proper header, treat as raw text
        lines.push(buffer.slice(offset).toString('utf8'));
        break;
      }

      // Read message length from header (bytes 4-7, big-endian)
      const msgLen = buffer.readUInt32BE(offset + 4);

      // Sanity check
      if (msgLen === 0 || msgLen > buffer.length - offset - 8) {
        // Invalid header, treat remaining as raw text
        lines.push(buffer.slice(offset).toString('utf8'));
        break;
      }

      // Extract the message (skip 8-byte header)
      const message = buffer.slice(offset + 8, offset + 8 + msgLen).toString('utf8');
      if (message.trim()) {
        lines.push(message.trim());
      }

      offset += 8 + msgLen;
    }

    return lines.join('\n');
  }

  /**
   * Get container status
   */
  async getStatus() {
    if (!this.container) return null;

    try {
      const info = await this.container.inspect();
      return {
        running: info.State.Running,
        status: info.State.Status,
        startedAt: info.State.StartedAt,
        health: info.State.Health?.Status,
        exitCode: info.State.ExitCode,
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Get connection information
   */
  getConnectionInfo() {
    return {
      baseUrl: `http://localhost:${this.ports.http}`,
      httpsUrl: `https://localhost:${this.ports.https}`,
      wsUrl: `ws://localhost:${this.ports.http}/signalk/v1/stream`,
      wssUrl: `wss://localhost:${this.ports.https}/signalk/v1/stream`,
      apiUrl: `http://localhost:${this.ports.http}/signalk/v1/api`,
      tcpPort: this.ports.tcp,
      udpPort: this.ports.udp,
      httpsPort: this.ports.https,
      dataDir: this.dataDir,
      containerId: this.container?.id,
    };
  }

  /**
   * Execute command inside container
   */
  async exec(command) {
    if (!this.container) throw new Error('Container not running');

    const exec = await this.container.exec({
      Cmd: ['sh', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
    });

    return new Promise((resolve, reject) => {
      exec.start((err, stream) => {
        if (err) return reject(err);
        let output = '';
        stream.on('data', (chunk) => (output += chunk.toString()));
        stream.on('end', () => resolve(output));
        stream.on('error', reject);
      });
    });
  }

  /**
   * Get container stats (CPU, memory)
   */
  async getStats() {
    if (!this.container) return null;

    return new Promise((resolve, reject) => {
      this.container.stats({ stream: false }, (err, stats) => {
        if (err) return reject(err);

        const cpuDelta =
          stats.cpu_stats.cpu_usage.total_usage -
          stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta =
          stats.cpu_stats.system_cpu_usage -
          stats.precpu_stats.system_cpu_usage;
        const cpuPercent =
          (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100;

        const memUsage = stats.memory_stats.usage;
        const memLimit = stats.memory_stats.limit;
        const memPercent = (memUsage / memLimit) * 100;

        resolve({
          cpu: {
            percent: cpuPercent.toFixed(2),
          },
          memory: {
            usage: memUsage,
            limit: memLimit,
            percent: memPercent.toFixed(2),
            usageMB: (memUsage / 1024 / 1024).toFixed(2),
          },
        });
      });
    });
  }

  /**
   * Copy file to container
   */
  async copyToContainer(localPath, containerPath) {
    if (!this.container) throw new Error('Container not running');

    const tar = require('tar-fs');
    const stream = tar.pack(path.dirname(localPath), {
      entries: [path.basename(localPath)],
    });

    await this.container.putArchive(stream, { path: containerPath });
  }
}

module.exports = { ContainerManager };
