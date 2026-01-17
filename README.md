# SignalK Server Docker Release Validation Suite

Comprehensive pre-release validation framework for SignalK Server Docker images. This test suite validates the official Docker image against real-world scenarios, monitoring logs for errors throughout all test phases.

## Overview

This framework is designed to run before major releases to ensure:

- Server starts and stops cleanly without errors
- All core plugins load correctly
- NMEA 0183 input (TCP/UDP) works as expected
- NMEA 2000 input processes correctly
- REST API endpoints function correctly
- WebSocket streaming works properly
- Delta PUT operations succeed
- Data unit conversions are accurate
- Authentication and authorization work correctly
- Admin UI functions properly
- Real-world sailing scenarios complete without errors
- Resources API (waypoints, routes, notes) works
- Course navigation and autopilot integration
- HTTPS/TLS security is properly configured
- mDNS service discovery works
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

# Run fast validation (shorter timeouts)
npm run test:fast

# Test specific version
SIGNALK_IMAGE=signalk/signalk-server:2.0.0 npm run test:release

# Run individual test categories
npm run test:lifecycle    # Server start/stop/restart
npm run test:plugins      # Plugin loading
npm run test:nmea         # NMEA 0183 TCP/UDP input
npm run test:nmea2000     # NMEA 2000 input
npm run test:scenarios    # Real-world scenarios
npm run test:rest-api     # REST API endpoints
npm run test:websocket    # WebSocket streaming
npm run test:delta-put    # Delta PUT operations
npm run test:conversion   # Data unit conversions
npm run test:auth         # Authentication
npm run test:resources    # Resources API (waypoints, routes)
npm run test:course       # Course navigation
npm run test:history      # Historical playback
npm run test:multi-auth   # Multi-user authentication
npm run test:ais          # AIS comprehensive
npm run test:https        # HTTPS/TLS security
npm run test:mdns         # mDNS discovery
npm run test:stress       # Stress tests
npm run test:sustained    # Sustained load tests

# Admin UI tests
npm run test:ui-dashboard
npm run test:ui-databrowser
npm run test:ui-plugins
npm run test:ui-security
```

## Test Summary

| Category | Tests | Description |
|----------|-------|-------------|
| Server Lifecycle | 10 | Start, stop, restart, crash recovery |
| Plugin Loading | 12 | Core plugins, enable/disable, config |
| NMEA 0183 Input | 28 | TCP/UDP, all sentence types, AIS |
| NMEA 2000 Input | 19 | PGN processing, data conversion |
| Real-World Scenarios | 7 | Coastal sailing, anchoring, AIS traffic |
| Admin UI | 16 | Dashboard, data browser, plugins, security |
| Stress Tests | 5 | High throughput, memory, CPU |
| REST API | 24 | Discovery, data model, vessels |
| WebSocket Streaming | 21 | Subscriptions, deltas, reconnection |
| Delta PUT | 17 | REST PUT, WS delta, propagation |
| Data Conversion | 24 | Units, precision, edge cases |
| Authentication | 12 | Login, tokens, CORS |
| NMEA Output | 10 | SignalK to NMEA0183 |
| End-to-End Flow | 10 | Complete data path validation |
| Sustained Load | 6 | Long-running stability |
| Resources API | 26 | Waypoints, routes, notes, regions |
| Course Navigation | 21 | Active route, autopilot |
| Historical Playback | 18 | Snapshots, playback, history |
| Multi-User Auth | 25 | JWT, roles, ACL, sessions |
| AIS Comprehensive | 29 | All AIS message types |
| HTTPS/TLS | 14 | Certificates, WSS, security headers |
| mDNS Discovery | 17 | Service advertisement, discovery |
| **Total** | **371** | |

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

### 12. REST API (`12-rest-api.test.js`)
- SignalK discovery document
- Data model endpoints
- Vessel data retrieval
- Navigation and environment paths
- CORS headers and content types

### 13. WebSocket Streaming (`13-websocket-streaming.test.js`)
- Connection and hello message
- Subscription modes (all, none, self)
- Path-based and wildcard subscriptions
- Delta message format
- Rate limiting (minPeriod)
- Reconnection handling

### 14. Delta PUT Operations (`14-delta-put.test.js`)
- REST PUT to SignalK paths
- WebSocket delta sending
- Delta propagation to subscribers
- Error handling for invalid deltas

### 15. Data Conversion (`15-data-conversion.test.js`)
- Latitude/longitude conversion
- Speed (knots to m/s)
- Angles (degrees to radians)
- Depth measurements
- Temperature (Celsius to Kelvin)
- Precision validation

### 16. Authentication (`16-authentication.test.js`)
- Public endpoint access
- Admin endpoint protection
- Login/logout flows
- Token validation
- CORS and security headers

### 17. NMEA Output (`17-nmea-output.test.js`)
- SignalK to NMEA0183 conversion
- Output sentence validation
- Position/speed/heading accuracy

### 18. End-to-End Flow (`18-end-to-end-flow.test.js`)
- NMEA input to REST API output
- NMEA input to WebSocket output
- PUT updates through the system
- Data consistency validation

### 19. Sustained Load (`19-sustained-load.test.js`)
- 2+ minute continuous operation
- Memory stability monitoring
- WebSocket connection stability
- Mixed protocol sustained input

### 20. Resources API (`20-resources-api.test.js`)
- Waypoints CRUD operations
- Routes with GeoJSON validation
- Notes and regions management
- Charts listing
- Bounding box and distance filtering

### 21. Course Navigation (`21-course-navigation.test.js`)
- Active route management
- Next/previous waypoint
- Cross track error calculation
- Bearing and distance to waypoint
- Autopilot state endpoints

### 22. Historical Playback (`22-historical-playback.test.js`)
- Snapshot API with timestamps
- WebSocket playback (startTime, playbackRate)
- History queries with time ranges
- Playback control (pause, seek)

### 23. Multi-User Auth (`23-multi-user-auth.test.js`)
- JWT token validation
- Role-based access control
- ACL path permissions
- Device authentication
- Session management

### 24. AIS Comprehensive (`24-ais-comprehensive.test.js`)
- Class A position reports (Types 1-3)
- Static/voyage data (Type 5)
- Class B reports (Types 18-19, 24)
- Aid to Navigation (Type 21)
- Multi-sentence message assembly
- High-volume AIS handling

### 25. HTTPS/TLS (`25-https-tls.test.js`)
- TLS certificate validation
- Modern TLS version support
- WSS (secure WebSocket)
- Security headers (HSTS, etc.)
- HTTP to HTTPS redirect

### 26. mDNS Discovery (`26-mdns-discovery.test.js`)
- Service advertisement
- Discovery endpoint format
- Server identity and version
- Service types validation

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
│   ├── 03-nmea0183.test.js
│   ├── 05-nmea2000-input.test.js
│   ├── 06-realworld-scenarios.test.js
│   ├── 07-admin-dashboard.test.js
│   ├── 08-admin-databrowser.test.js
│   ├── 09-admin-plugins.test.js
│   ├── 10-admin-security.test.js
│   ├── 11-stress-test.test.js
│   ├── 12-rest-api.test.js
│   ├── 13-websocket-streaming.test.js
│   ├── 14-delta-put.test.js
│   ├── 15-data-conversion.test.js
│   ├── 16-authentication.test.js
│   ├── 17-nmea-output.test.js
│   ├── 18-end-to-end-flow.test.js
│   ├── 19-sustained-load.test.js
│   ├── 20-resources-api.test.js
│   ├── 21-course-navigation.test.js
│   ├── 22-historical-playback.test.js
│   ├── 23-multi-user-auth.test.js
│   ├── 24-ais-comprehensive.test.js
│   ├── 25-https-tls.test.js
│   └── 26-mdns-discovery.test.js
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
