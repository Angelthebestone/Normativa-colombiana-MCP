For any AI or human agent. This is law. Optimized for high-quality, maintainable, efficient systems in any language.


### 1. ARCHITECTURE & MODULARITY

**The Golden Rule: Package by Feature, NEVER by Type.**

- **FORBIDDEN:** `src/utils/`, `src/helpers/`, `src/common/`, `src/models/`, `src/controllers/`, `src/managers/`. If you create `utils`, you failed to name the domain.
- **REQUIRED - Screaming Architecture:** src/
billing/ # Business capability
domain/ # Pure business logic, zero dependencies
application/ # Use cases / Services
infrastructure/ # DB, API clients, adapters
presentation/ # HTTP handlers, CLI
users/
- **Dependency Rule:** `domain` -> knows nothing. `application` -> depends on domain ports. `infrastructure` -> implements ports. Dependencies point INWARD.
- **Principles:** SOLID, High Cohesion / Low Coupling, Composition over Inheritance, Law of Demeter (no `a.b().c().d()`), Immutability by default.
- **File Size:** Max 300 lines. One concept per file. If file needs `And` in its name, split it.
- **No God Objects, No Singletons with mutable state.**
### 2. NAMING - Architecture is Naming

- **Folders = Business Nouns:** `orders/`, `payments/` GOOD. `misc/` BAD.
- **Files = Domain Concepts:** `order_validator`, `payment_processor` GOOD. `helper`, `util`, `manager` BAD.
- **Functions = Verbs + Intent:** `calculateTotalWithTax()` GOOD. `doCalc()`, `process()`, `handle()` BAD.
- **Booleans = Questions:** `isPaid`, `hasAccess`, `canCheckout`.
- **Constants:** No magic numbers. `if status == 2` FORBIDDEN. `if status == OrderStatus.PAID` REQUIRED.
- **Consistency:** `getUser` OR `fetchUser`, never both. `snake_case` or `camelCase` per language, but consistent.

### 3. CODE QUALITY & ANTI-DRY

- **DRY - Zero Tolerance for Duplication:** 3 lines duplicated twice = extract to domain function.
- **KISS & YAGNI:** Don't abstract prematurely. Don't build for "future". Simplest solution that satisfies behavior wins.
- **Functions:** Max 3 params (else use DTO), Max 1 indent level (use guard clauses `if !valid { return err }`), Cyclomatic Complexity < 10.
- **No `else` hell, no nested loops > 2 levels.**

### 4. EFFICIENCY & PERFORMANCE

- **Choose Data Structures Consciously:** Default to O(1) lookups (Map/Set). Document Big O in comment for any core logic.
- **Resource Efficiency:** No allocations in hot loops, no N+1 queries, use `with_capacity`, connection pools, streaming for large datasets.
- **No Premature Optimization, but No Pessimization:** Measure before optimizing. Add performance budget: p95 < 200ms for API, no O(n^2) in request path.
- **Concurrency:** Atomics > Mutex for counters. No `Mutex` inside async. No blocking IO (`sleep`, `fs.readSync`) in async path. Use `spawn_blocking`.
- **Idempotency:** All operations that can be retried MUST be idempotent.

### 5. DATA & API DESIGN

- **API Design:** REST must be resource-oriented, paginated (`cursor` not `offset`), versioned (`/v1/`), and idempotent (`Idempotency-Key`). Use DTOs, never expose domain entities directly.
- **Data Modeling:** Model invariants in types, not in comments. Use value objects. DB schema changes require migrations, never manual edits.
- **Configuration - 12 Factor:** No hardcoded config. Use env vars. Config fails fast on startup.
- **Feature Flags:** New behavior behind flags, not `if` branches commented.

### 6. ERROR HANDLING, SECURITY, OBSERVABILITY

- **Errors:** Typed domain errors `Result<T, DomainError>`. Library = `thiserror`, App = `anyhow` with context. NEVER `panic!`, `unwrap()` in lib, empty `catch`.
- **Security - OWASP:** Validate all inputs at boundary. No secrets in code/logs. No SQL/NoSQL injection (use parameterized queries). Principle of Least Privilege. Run `cargo audit` / `npm audit`.
- **Observability:** No `print`. Use structured logging `tracing`/`pino`. Log context `{orderId, userId}`, not strings. Metrics for business events, traces for request flow. Never log PII.

### 7. TESTING - THE MOST IMPORTANT SECTION

**TEST BEHAVIOR, NOT IMPLEMENTATION. THIS IS LAW.**

- **FORBIDDEN:** Testing private methods, asserting `mockRepo.save.calledOnce`, testing internal state.
- **REQUIRED:** Test public observable behavior: `Given [state] When [action] Then [observable output/side effect]`.

**Testing Matrix:**
- **Unit:** Domain logic only. Fast, deterministic, no IO. Use Given-When-Then: `should_reject_order_when_cart_empty`
- **Integration:** Test Port + Adapter (e.g., Real DB via testcontainers, Real API client). Verify wiring.
- **Contract/E2E:** Critical user flows only.

**Rules:** Tests must be deterministic, isolated, < 100ms for unit. No `sleep`, no network in unit tests. Use Fakes, not excessive Mocks.

### 8. DEPENDENCIES & TOOLING

- **No new dependency for a 10-line problem.** Check stdlib first.
- **Lockfiles committed.** Minimal dependency tree.
- **Devex:** `format`, `lint`, `typecheck`, `test` must pass before done.

### 9. DOCUMENTATION & GIT

- **Comments explain WHY, not WHAT.** If WHAT needs comment, rename.
- **Public API:** Must have docstring with runnable example.
- **Git:** Conventional Commits `feat:`, `fix:`, `refactor:`. Small atomic PRs. One PR = One concern. PR explains WHY, not WHAT.

### 10. DEFINITION OF DONE & SELF-REVIEW CHECKLIST

Before you say "done", check:

- [ ] Package by Feature respected? No `utils/`?
- [ ] Naming screams business intent? No `manager`, `data`, `helper`?
- [ ] No duplication? No magic numbers?
- [ ] DRY, KISS, SOLID respected? File < 300 lines? Function < 50 lines?
- [ ] Efficiency: Big O considered? No N+1? No blocking in async?
- [ ] Errors typed with context? No `unwrap`/`panic` in prod?
- [ ] Security: inputs validated? No secrets?
- [ ] Tests verify BEHAVIOR (input->output) not implementation (mock calls)? Happy + Error + Edge covered?
- [ ] `fmt`, `lint`, `test`, `audit` green?
- [ ] No debug logs left?

### 11. PROHIBITED

1. Creating `utils`, `common`, `helpers` folders.
2. `any`, `Object`, `interface{}` to bypass types.
3. `console.log` / `println!` debug code.
4. Copy-paste instead of reusing domain.
5. Testing implementation details.
6. God files, God functions, boolean trap `do(true, false)`.