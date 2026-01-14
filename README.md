# SignalK Server Docker Release Validation Suite

Comprehensive pre-release validation framework for SignalK Server Docker images. This test suite validates the official Docker image against real-world scenarios, monitoring logs for errors throughout all test phases.

## Overview

This framework is designed to run before major releases to ensure:

- Server starts and stops cleanly without errors
- All core plugins load correctly
- NMEA 0183 input (TCP/UDP) works as expected
- NMEA 2000 input processes correctly
- Admin UI functions properly
- Real-world sailing scenarios complete without errors
- No regressions from previous versions

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Release Validation Pipeline                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │              CONTINUOUS LOG MONITORING                         │ │
│  │   (All phases monitored - any ERROR/WARN fails the test)       │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                              ↓                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │  Pull    │→ │  Start   │→ │  Plugin  │→ │  Input   │→            │
│  │  Image   │  │  Server  │  │  Loading │  │  Feeds   │             │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘             │
│                                                         ↓           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │  Admin   │← │ Lifecycle│← │  Data    │← │  Real    │             │
│  │    UI    │  │  Tests   │  │  Verify  │  │  World   │             │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+
- Docker installed and running
- Chrome/Chromium (installed automatically via Playwright)

### Installation

```bash
git clone https://github.com/signalk/signalk-release-tests.git
cd signalk-release-tests
npm install
npm run prepare  # Installs Playwright browsers
```

### Running Tests

```bash
# Run full validation suite against latest image
npm run test:release

# Test specific version
SIGNALK_IMAGE=signalk/signalk-server:2.0.0 npm run test:release

# Run individual test categories
npm run test:lifecycle
npm run test:plugins
npm run test:nmea-tcp
npm run test:scenarios
npm run test:ui-dashboard
```

## Test Categories

### 1. Server Lifecycle (`01-server-lifecycle.test.js`)
- Fresh start from clean state
- Graceful shutdown
- Restart with existing data
- Crash recovery (SIGKILL)
- Restart command handling

### 2. Plugin Loading (`02-plugin-loading.test.js`)
- Core plugins load without errors
- Plugin enable/disable cycles
- Plugin configuration persistence
- No plugin-related errors in logs

### 3. NMEA 0183 TCP (`03-nmea0183-tcp.test.js`)
- TCP connection acceptance
- Navigation sentence processing (RMC, GGA, VTG, HDG)
- Environment sentence processing (DBT, MWV, XDR)
- AIS message processing
- High-frequency burst handling
- Malformed sentence handling

### 4. NMEA 0183 UDP (`04-nmea0183-udp.test.js`)
- UDP listener functionality
- Same sentence types as TCP
- Mixed protocol scenarios

### 5. NMEA 2000 Input (`05-nmea2000-input.test.js`)
- Canboat JSON processing
- Common PGN handling
- N2K to SignalK conversion

### 6. Real-World Scenarios (`06-realworld-scenarios.test.js`)
- Coastal sailing simulation
- Anchor watch scenario
- Heavy AIS traffic
- Mixed protocol simultaneous input
- Instrument burst scenarios

### 7-10. Admin UI Tests
- Dashboard loading and WebSocket data
- Data Browser navigation
- Plugin management interface
- Security settings
- Server configuration
- Connection management

### 11. Stress Tests (`11-stress-test.test.js`)
- Extended duration runs
- High message throughput
- Memory leak detection
- CPU usage monitoring

## Log Monitoring

The framework continuously monitors container logs throughout all test phases. Any of these patterns trigger a test failure:

**Critical Errors:**
- `ERROR`, `FATAL`
- `Uncaught Exception`, `Unhandled Rejection`
- `ECONNREFUSED`, `EADDRINUSE`
- `Cannot find module`
- `SyntaxError`, `TypeError`, `ReferenceError`
- `segmentation fault`, `out of memory`

**Warnings (reported but don't fail):**
- `WARN`, `warning`
- `deprecated`

## GitHub Actions

The repository includes GitHub Actions workflows for:

### Manual Release Validation
```yaml
# Trigger manually with specific image tag
workflow_dispatch:
  inputs:
    image_tag: 'latest'  # or '2.0.0', '2.0.0-beta.1', etc.
```

### Nightly Validation
Runs automatically every night against `latest` tag.

## Directory Structure

```
signalk-release-tests/
├── .github/
│   └── workflows/
│       ├── release-validation.yml
│       └── nightly-validation.yml
├── config/
│   ├── test-settings.json
│   ├── security-settings.json
│   └── plugin-config.json
├── fixtures/
│   ├── nmea0183/
│   │   ├── navigation-session.log
│   │   ├── environment-session.log
│   │   ├── ais-traffic.log
│   │   └── malformed-mixed.log
│   ├── nmea2000/
│   │   └── canboat-log.json
│   └── scenarios/
│       ├── coastal-sailing.json
│       ├── anchoring.json
│       └── ais-heavy-traffic.json
├── lib/
│   ├── log-monitor.js
│   ├── container-manager.js
│   ├── nmea-feeder.js
│   ├── n2k-simulator.js
│   ├── admin-ui-tester.js
│   ├── data-validator.js
│   └── custom-reporter.js
├── tests/
│   ├── setup.js
│   ├── 01-server-lifecycle.test.js
│   ├── 02-plugin-loading.test.js
│   ├── 03-nmea0183-tcp.test.js
│   ├── 04-nmea0183-udp.test.js
│   ├── 05-nmea2000-input.test.js
│   ├── 06-realworld-scenarios.test.js
│   ├── 07-admin-dashboard.test.js
│   ├── 08-admin-databrowser.test.js
│   ├── 09-admin-plugins.test.js
│   ├── 10-admin-security.test.js
│   ├── 11-stress-test.test.js
│   └── 99-teardown.test.js
├── scripts/
│   ├── generate-report.js
│   └── generate-fixtures.js
├── reports/
│   └── .gitkeep
├── package.json
├── jest.config.js
└── README.md
```

## Reports

After test completion, reports are generated in `reports/`:

- `summary.md` - Human-readable summary
- `results.json` - Machine-readable results
- `logs/` - Container logs from each phase
- `screenshots/` - UI test screenshots

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SIGNALK_IMAGE` | `signalk/signalk-server:latest` | Docker image to test |
| `TEST_TIMEOUT` | `120000` | Test timeout in ms |
| `HTTP_PORT` | `3000` | SignalK HTTP port |
| `TCP_PORT` | `10110` | NMEA TCP input port |
| `UDP_PORT` | `10111` | NMEA UDP input port |

### Test Settings

Edit `config/test-settings.json` to customize the SignalK server configuration used during tests.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests or fixtures
4. Submit a pull request

## License

Apache-2.0

## Related Projects

- [SignalK Server](https://github.com/SignalK/signalk-server)
- [SignalK Specification](https://signalk.org/specification/)
