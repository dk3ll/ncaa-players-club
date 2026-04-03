# NCAA Players Club — Roadmap

## Immediate
- [ ] Run full e2e test suite and fix any remaining issues (betadraft player pool, dashboard data)

## Features
- [ ] ESPN-style commentary — AI-generated recaps after each draft round and after the full draft completes (big picks, steals, reaches, team grades)
- [ ] Additional player ranking formulas — multiple scoring models beyond the current fantasy score composite
- [ ] Injury indicator — flag injured players during the draft and leading up to the tournament

## Infrastructure
- [ ] Custom domain registration and DNS setup
- [ ] Concurrent draft scaling — support multiple simultaneous draft rooms without performance degradation
- [ ] EC2 Graviton deployment — optimize Docker build and deployment for ARM64/Graviton instances
