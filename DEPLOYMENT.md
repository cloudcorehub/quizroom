# Host a playable web preview

The app needs a running Node.js server. GitHub stores the source; GitHub Pages alone cannot run the multiplayer server.

## Fastest path: Render

[Deploy the preview on Render](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fcloudcorehub%2Fquizroom)

1. Sign in to your Render account and open the link above.
2. Review the service defined by `render.yaml`. It uses the **Free** plan and one server instance; no database or paid add-on is provisioned by this template.
3. Create the service. The build runs `npm test`; the start command is `npm start`.
4. Wait for the service to become live, then open the HTTPS address shown in the dashboard. Render supplies an `onrender.com` address and TLS, so you do not need to buy a domain.
5. Choose **Host this quiz**, share the website and PIN, and have a friend join from a different device. Verify a full round before inviting a larger group.

This link sets up a service in your Render account. Publishing the repository itself does not deploy a live game.

The checked-in template pins Node through `.node-version`, sets `HOST=0.0.0.0`, uses Render's provided `PORT`, and checks `/healthz`. Automatic deploys are off so a source-code push does not unexpectedly reset a game. Trigger deployments manually between sessions.

Official references: [Render web services](https://render.com/docs/web-services), [Blueprint configuration](https://render.com/docs/blueprint-spec), and [Deploy to Render](https://render.com/docs/deploy-to-render).

## Free hosting versus regular use

Render's Free service is suitable for evaluating this prototype. It sleeps after 15 minutes without inbound traffic and takes about one minute to wake. Free services have usage limits and are not recommended by Render for production. [Free service limitations](https://render.com/docs/free).

For regular scheduled games, consider the smallest paid web service, currently starting at $7/month for compute. Other charges depend on usage and selected services; review the current checkout price. Paid compute avoids Free-plan sleeping but does not add persistence to this app. [Render compute pricing reference](https://render.com/articles/render-vs-railway).

Software access remains free. Hosting charges belong to the operator. A custom domain is optional and can be connected later. Players can use a phone or desktop browser; they do not need an app-store download.

## Current operating constraints

- **Keep exactly one server instance.** Rooms are held in that process's memory. Multiple instances will not share PINs, participants, or scores.
- **Restarts and deployments end active games.** A paid plan or attached disk alone will not change this: persistent game storage has to be implemented.
- **Quiz drafts stay in the creator's browser.** Export them as JSON to retain a separate copy. There is no cross-device account library yet.
- **Host and player sessions recover within the same browser tab.** Closing the tab or switching devices can lose the stored session token.
- **The 100-player limit is a validation limit, not a tested capacity promise.** Begin with a small group and measure before increasing the audience.
- **Public abuse protection is incomplete.** Rate limiting, host moderation, durable storage, backups, and monitoring remain priorities before an unrestricted public launch.

Do not deploy during a live event. If you fork the template and change its plan, keep the YAML and dashboard settings aligned so a later Blueprint sync does not restore an older plan.

## What is needed for broader public hosting

1. A hosting account owned by the operator, with billing enabled if a paid plan is selected.
2. Persistent quiz/result storage and restart recovery, implemented and tested in the server.
3. Controls for excessive room creation, repeated PIN guesses, and unwanted participants.
4. Phone-browser and concurrency testing, error monitoring, and database backups.
5. A distinct public name and contact information for the hosted service. The repository currently uses the working name Quizroom.

A managed database would be a later addition; creating one now will not automatically persist this version's data.

## Manual deployment on another host

Use one long-running Node.js 24 process with an HTTPS reverse proxy that supports server-sent events. Do not enable response buffering for `/api/rooms/:pin/events`; keep event-stream connections open and allow reconnection. Do not cache authenticated API responses or log session-token query strings.

```sh
HOST=0.0.0.0 PORT=4173 NODE_ENV=production npm start
```

Configure the host's health check to GET `/healthz`. The app returns `{"status":"ok"}` with HTTP 200. The probe checks process responsiveness, not persistence or multi-player capacity.

Avoid static-only hosting and short-lived function deployments for this version. The game depends on one shared process and timers that continue running throughout a round.
