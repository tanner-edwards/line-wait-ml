# Club 32 app

Source code for the Club 32 mobile app and its serverless backend. Lives alongside the existing line-wait-ml data pipeline at the repo root, which continues to run independently.

- **`frontend/`** — React Native + Expo iOS app (TypeScript).
- **`backend/`** — AWS Lambda function and SAM template (TypeScript). Deployed manually via `sam deploy` to AWS region `us-west-2`. Talks to the public Themeparks API and returns wait-time data shaped per the v0 spec.

See `~/.claude/specs/line-wait-ml/v0.md` for the v0 spec and `~/.claude/plans/line-wait-ml/v0.md` for the implementation plan.
