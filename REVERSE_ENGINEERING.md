# Kahoot.it: REA investigation and playable reconstruction

Inspected on 2026-10-26 using the installed `reverse-engineer-anything` skill and REA 6.8.0. Target: the public player application at <https://kahoot.it/>.

## Result

The classic game can be reconstructed as a server-controlled state machine with a host view and lightweight player views. A PIN identifies the room; a participant session identifies the player. The host controls progression, the server controls deadlines and scoring, and clients render the current state.

The independent implementation in this directory runs that loop end to end. It uses ordinary HTTP commands and SSE broadcasts. Kahoot’s shipped controller instead contains CometD transport code. This is functional reconstruction, not protocol compatibility or recovery of Kahoot’s private server implementation.

## What was directly observed

REA launched a temporary Chrome instance, navigated to `https://kahoot.it`, waited for the public entry controls, and captured DOM, accessibility, and network evidence. A second declared scenario clicked **Join** with the PIN blank and captured the validation state. No real game PIN, Kahoot account, or authenticated host session was used.

| Observation | Evidence |
| --- | --- |
| Public entry uses a PIN textbox and Join button | Initial accessibility capture |
| Empty submission remains on the join page and produces an accessible error | Second capture, `blank_pin` and `settle` steps |
| Language selector and links to Discover, Learn, Present, and Make appear on the settled page | Second accessibility capture |
| The page loads a module entrypoint, shared app chunks, CSS, and a controller bundle from Kahoot’s asset CDN | Captured DOM and HTTP responses |
| Build metadata identifies `controller v1.4330.0-5826c687703` | Initial captured DOM |
| The owned browser processes were terminated after both captures | `browser.cleanup = terminated-owned-process` |

These observations establish the entry behavior. They do not establish successful live joining or every game state at runtime.

## Shipped client findings

The main controller exceeded the selected capture-body budget, so its exact public asset URL, already present in REA’s capture, was downloaded separately for static analysis:

<https://assets-cdn.kahoot.it/controller/v2/assets/controller-CbWYRXqE.js>

- Size: **6,110,332 bytes**.
- SHA-256: `254632736af0e7046c7dc5ea933d344105661c8a1ba4cd872af248c0f4e691fa`.
- Local artifact: `research/controller-CbWYRXqE.js`.
- REA parsed this selected file as inert source. It was not executed as a local program.

Focused textual inspection of that same hashed file found the following. Locations are zero-based Unicode character offsets in the UTF-8-decoded file, not generated line numbers or execution traces.

| Finding | Location / source anchor | Interpretation |
| --- | --- | --- |
| React imports and Redux-style actions/reducers | `require_react`, `createAction$1`, `gameSessionReducer` | The controller includes React rendering and structured application state. This is not a claim about every Kahoot application. |
| CometD import and transport alternatives | Around 1,134,249: `WebSockets`, `LongPolling` | WebSocket and long-polling transport implementations are present. Which is selected in a real game was not measured. |
| CometD context path | Around 1,136,618: `/cometd` | A real-time messaging path is assembled from configuration. |
| Session reservation and challenge endpoint strings | Around 1,225,694: `/reserve/session`, `/rest/challenges/pin` | The client distinguishes live-session reservation from challenge lookup. No valid PIN endpoint was exercised. |
| Login, relogin, and message publish types | Around 1,134,308: `PublishType` | Joining and reconnection are explicit protocol concepts. |
| Coarse game states | Around 1,368,343: `GameState` | Joining, waiting to start, playing, and game over are enumerated. |
| Classic phase constants | Around 1,135,529 | Pre-quiz, quiz started, get ready, question started, question ended, scoreboard, and quiz ended are explicit states. |
| Reconnection restoration actions | Around 1,250,790 | The client can restore an already-started or already-ended question. |
| Multiple question/game-block types | Around 83,590: `GameBlockType` | Quiz, jumble, content, surveys, word clouds, multiple-select, and other formats are present; they were not all rebuilt. |

Short context excerpts and offsets for the initial searches are retained in `research/selected-symbols.json`. Because the controller combines many features and dependencies, a string or symbol’s presence does not prove that a particular path ran during the captured join flow.

## Game rules supported by official documentation

Kahoot documents launching a host lobby, displaying the PIN, player joining, starting the game, and reconnecting with an existing nickname/session. It also describes optional question text on player devices. [Kahoot: hosting a live game](https://support.kahoot.com/hc/en-us/articles/360039422694-How-to-host-a-live-kahoot).

The documented single-select score is:

```text
wrong answer or no answer = 0
correct answer under 0.5 seconds = 1000
otherwise = round(1000 × (1 − response_time / question_duration / 2))
```

For example, 2 seconds into a 30-second question earns 967 points. Streaks do not add a separate score bonus. The reconstruction uses server-measured response time and this standard formula. [Kahoot: how points work](https://support.kahoot.com/hc/en-us/articles/115002303908-How-points-work).

Documentation is separate evidence from runtime observation. No live Kahoot round was captured to independently compare timing or scores with these rules.

## Reconstruction mapping

| Kahoot concept | Local implementation | Status |
| --- | --- | --- |
| PIN entry and validation | Six-digit PIN entry, then nickname | Working; PIN format is our implementation choice |
| Host lobby and participant list | Per-room player list, join link, host start, lock toggle | Working |
| Ready phase | Three-second countdown | Working; duration is our implementation choice |
| Question and four choices | Same question/deadline on all connected screens | Working |
| Answer submission | One answer per participant per question | Working |
| Time or all answers ends question | Server timer and answer-count check | Working |
| Reveal | Correct choice and answer distribution; private per-player result | Working |
| Speed-based scoring | Published standard 1,000-point formula | Working and tested |
| Scoreboard and podium | Ranked scores after each question and at quiz end | Working |
| Rejoin | Token retained in session storage plus automatic SSE reconnection | Working on refresh in the same tab; new-device recovery is not implemented |
| Quiz authoring | Four answers, one correct choice, per-question timer | Working; narrower than Kahoot’s editor |
| Other game types and subscription features | No corresponding implementation | Out of scope |

Original visual assets, branding, question content, and application code were authored for the reconstruction. Captured Kahoot scripts are research inputs only and are not served or bundled by the app.

## Local architecture and API

`public/app.js` renders host and player states. `server.mjs` maintains room state, answers, identities, scores, and deadline timers. Authenticated event streams send role-filtered snapshots.

| Method | Local route | Purpose |
| --- | --- | --- |
| POST | `/api/rooms` | Create a room from validated quiz content; return host token and PIN |
| POST | `/api/rooms/:pin/join` | Register a nickname and return a player token |
| GET | `/api/rooms/:pin/state` | Retrieve the caller’s filtered state using its bearer token |
| GET | `/api/rooms/:pin/events` | Receive live snapshots using a session token |
| POST | `/api/rooms/:pin/answer` | Submit a question index and choice; server validates timing and uniqueness |
| POST | `/api/rooms/:pin/action` | Host-only start, reveal, next, lock, or restart |

These endpoints belong only to Quizroom. They are not replicas of Kahoot’s private API. Tokens are separate from the public PIN. Neither host tokens nor other players’ tokens are included in snapshots. Correct answers and score changes are withheld until the reveal. The server rejects stale question indices and unauthorized host commands.

## Evidence inventory

| File | Contents |
| --- | --- |
| `research/rea-evidence.json` | Original two REA browser-capture records |
| `research/public-capture.json` | Extracted second capture for script export |
| `research/captured-scripts/manifest.json` | REA’s script URLs, source references, sizes, hashes, and omissions |
| `research/captured-scripts/files/` | Fourteen exported script bodies; the main controller was omitted by the selected body budget |
| `research/controller-CbWYRXqE.js` | Separately fetched public controller for static analysis |
| `research/static-analysis-summary.json` | Compact REA analysis view with limitations |
| `research/rea-analysis-evidence.json` | Complete retained capture/export/static-analysis evidence, approximately 76 MB |
| `research/selected-symbols.json` | Focused source searches with locations |
| `research/home-preview.png` | Verified reconstruction home screen |
| `research/podium-preview.png` | Completed browser game with a score of 837 |

Key REA identifiers:

- Initial capture: `ev_4f8a8ce4f064b3798eafa6f3d542bba1c9e73fd576943d14c435341b0acb8631`.
- Blank-PIN scenario: `ev_0e41f4166a33fefa7f23dba703c68720843d4e38060e18ce77def4d5ff634b2c`.
- Captured-script export: `ev_b6a262b703ede57503682ea84ca3f76a88b48167425be2940f662be5a016e42f`.
- Static analysis parent: `ev_878f0427ecf2e1a603352355d26762377d1acf8124fb60f96ca42f6c07ccef0d`.
- Static summary view: `ev_9057048d86149f5154370d68acc903356f8c38d5d8259113d1d7a0f06bfdacb3`.

## Coverage limits

- The second capture completed its declared UI steps, but its network/event evidence is incomplete: selected body/event budgets omitted some data. The complete result was larger than MCP’s response budget and was exported to disk rather than silently summarized or discarded.
- The separately downloaded controller has its own hash. It is a subsequent public fetch, not a recovered body from the original capture.
- REA parsed the selected controller without parse failures and visited 798,535 AST nodes. Semantic analysis was partial because bounded node/unknown retention and alias expansion limits were reached. Seventeen inventoried files were outside the selected source scope.
- Source symbols and endpoint strings are static evidence. They do not establish network reachability, execution, backend source code, or a complete protocol specification.
- No authenticated host/editor flow, active Kahoot game session, paid capability, or private dataset was inspected.
- The local recreation has passed functional tests and a browser walkthrough, but has not been load-tested or prepared as a public production service.
