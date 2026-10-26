# Contributing

Quizroom is a free, open-source live quiz game. The initial release has no subscriptions, paid tiers, or paywalls. Quizroom is a working name; a public launch name has not been selected.

## Local development

Use Node.js 22 or later. This project has no npm dependencies and requires no install step.

```sh
npm start
```

Open http://localhost:4173. Host a quiz in one tab, then choose **Open player screen** to join in another tab. Set `PORT` to use another local port. Set `HOST=0.0.0.0` only when you want other devices on your network to connect.

The application has three main parts:

- `server.mjs`: room state, request validation, deadlines, scoring, and event streams.
- `public/app.js` and `public/style.css`: the quiz editor and host/player interfaces.
- `test/game.test.mjs`: HTTP and event-stream integration tests and scoring examples.

## Changes

Keep changes focused and describe the user-visible behavior they improve. Include reproduction steps for bugs. For game-state, scoring, or authorization changes, add or update tests for the affected behavior.

Before submitting changes, run:

```sh
npm test
node --check server.mjs
node --check public/app.js
```

For interface changes, check both a narrow phone-sized layout and a desktop layout. Verify a complete host/player game and page-refresh recovery when changing the live flow.

Do not include credentials, personal player information, generated archives, or files from `research/`. Research captures and third-party scripts remain local reference material; they are not dependencies of this application or part of its source distribution. Contributions should contain original code or material you have permission to contribute under MIT.

## Current priorities

- Persistent quiz and result storage, with restart recovery.
- Abuse protection for room creation, joining, and live connections.
- Host moderation and a dependable reconnect experience.
- Load testing and real-device browser testing.
- Deployment health checks, monitoring, and backups.

## License

Contributions are made under the project's [MIT license](LICENSE). MIT permits reuse, modification, distribution, and commercial use while requiring preservation of its copyright and license notice.
