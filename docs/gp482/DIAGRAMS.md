# Wethaq GP482 — diagrams

All diagrams are Mermaid (they render on GitHub) and describe the code in this repository. Four are in
[ARCHITECTURE.md](ARCHITECTURE.md) next to the text they illustrate, one is in [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md), and
the other five are below.

| # | Diagram | Where |
| --- | --- | --- |
| 1 | System context | [ARCHITECTURE.md §1](ARCHITECTURE.md#1-system-context) |
| 2 | Ledger transaction sequence (request → endorsement → commit → PostgreSQL) | [ARCHITECTURE.md §4](ARCHITECTURE.md#4-transaction-outcomes) |
| 3 | Ledger operation states (Case A/B/C, reconciliation) | [ARCHITECTURE.md §4](ARCHITECTURE.md#4-transaction-outcomes) |
| 4 | PostgreSQL data model | [ARCHITECTURE.md §5](ARCHITECTURE.md#5-synchronization-between-fabric-and-postgresql) |
| 5 | Deployment | [DEPLOYMENT_GUIDE.md §1](DEPLOYMENT_GUIDE.md#1-deployment-architecture) |
| 6 | Backend components | [below](#6-backend-components) |
| 7 | Sign-in and authorization | [below](#7-sign-in-and-authorization) |
| 8 | Forecasting and inventory data flow | [below](#8-forecasting-and-inventory-data-flow) |
| 9 | Fabric network topology | [below](#9-fabric-network-topology) |
| 10 | Shipment lifecycle and the rules the chaincode enforces | [below](#10-shipment-lifecycle) |

## 6. Backend components

```mermaid
flowchart TB
  subgraph API["wethaq-api (Node 22, Express)"]
    direction TB
    MW["Middleware<br/>helmet · request id · JSON 32 kB · CORS (one origin) · rate limit on sign-in"]
    Auth["auth.ts<br/>bcrypt · JWT HS256 · requireAuth · requireRole"]
    Routes["app.ts routes<br/>/auth · /state · /inventory · /shipments · /alerts · /users · /admin · /analytics · /events"]
    subgraph Services["services/"]
      Ship["shipments.ts<br/>create · operate · verify · demo rejections"]
      Ops["operations.ts<br/>executeOperation · applyRecord<br/>event consumer · reconciler"]
      Inv["inventory.ts<br/>positions · classify · shortage alerts"]
      Ana["analytics.ts<br/>result files + SHA-256 provenance<br/>/analytics/v1 filters"]
      Aud["audit.ts"]
      State["state.ts<br/>dashboard snapshot"]
    end
    subgraph Ledger["ledger/"]
      LI["types.ts — Ledger interface<br/>LedgerError categories"]
      LF["fabric.ts — Fabric Gateway client<br/>2 orgs · qscc status · chaincode events"]
      LL["local.ts — development ledger<br/>(PostgreSQL, same rules, not Fabric)"]
    end
    Bus["events.ts — in-process event bus"]
    Log["logger.ts — JSON lines, secrets redacted"]
  end
  Rules["chaincode/shipment/src/rules.ts<br/>(shared rule code)"]
  PG[("PostgreSQL")]
  Fabric[["Fabric peers Org1 + Org2"]]
  Files[/"analysis/results/*.json"/]

  MW --> Auth --> Routes
  Routes --> Ship & Inv & Ana & State & Aud
  Ship --> Ops --> LI
  LI --> LF --> Fabric
  LI --> LL --> PG
  Ops --> Inv
  Ops --> Bus --> Routes
  Ship & Inv & State & Aud & Ops --> PG
  Ana --> Files
  Ship -. rule checks .-> Rules
  LL -. same rules .-> Rules
```

`LEDGER_MODE` picks `fabric.ts` or `local.ts` once at start-up; Fabric mode never falls back to the local ledger.

## 7. Sign-in and authorization

```mermaid
sequenceDiagram
  autonumber
  participant B as Dashboard
  participant A as API
  participant DB as PostgreSQL
  participant L as Ledger
  B->>A: POST /api/auth/login {email, password}
  Note over A: at most 10 attempts per minute per address
  A->>DB: find user by email
  A->>A: bcrypt compare (also for unknown emails)
  alt wrong password, inactive, or expired temporary password
    A->>DB: audit auth.login denied
    A-->>B: 401
  else valid
    A->>DB: audit auth.login ok
    A-->>B: JWT (HS256, sub = user id, 8 h) + user + ledger kind
  end
  B->>A: any request, Authorization: Bearer JWT
  A->>A: verify signature and expiry
  A->>DB: load the user again (role, organization, MSP, active)
  alt must change temporary password
    A-->>B: 403 PASSWORD_CHANGE_REQUIRED (only /auth/me and /auth/password allowed)
  else role not permitted for the action
    A-->>B: 403
  else permitted
    Note over A: the MSP comes from the user's organization in PostgreSQL,<br/>never from the request body
    A->>L: submit with that organization's application identity (wethaq-app)
    L-->>A: outcome
    A->>DB: record + audit (user id, organization, request id)
    A-->>B: result
  end
```

The application identity is a service identity per organization: the dashboard user is recorded with each
operation (ledger record and audit log), but users do not sign transactions with keys of their own.

## 8. Forecasting and inventory data flow

```mermaid
flowchart LR
  subgraph Offline["Offline analysis (Python, run by hand)"]
    RAF[/"RAF spare-parts demand<br/>(real, public)"/]
    SYN[/"Synthetic aviation panel<br/>60 parts × 3 locations"/]
    Scripts["analysis/scripts<br/>assess.py · forecast.py · raf_export.py<br/>rolling_raf.py · inventory_sim.py"]
    Results[/"analysis/results/*.json<br/>(committed, unchanged by the API)"/]
    RAF --> Scripts
    SYN --> Scripts
    Scripts --> Results
  end
  subgraph APIF["API"]
    Load["loadArtifact<br/>+ SHA-256, script, dataset"]
    V1["/api/analytics/v1<br/>datasets · methods · parts · forecast<br/>metrics · classification · rolling<br/>inventory-simulation · provenance"]
    Pos["inventoryPositions<br/>on hand + in transit → status"]
    Short["checkShortage → alert<br/>(one open alert per position)"]
  end
  subgraph DBF["PostgreSQL"]
    InvT[("inventory")]
    ShipT[("shipments")]
    AlertT[("alerts")]
  end
  subgraph Dash["Dashboard (live mode)"]
    FP["Forecasts page<br/>badge: file · SHA-256"]
    OV["Overview"]
    IP["Inventory & alerts"]
  end
  Results --> Load --> V1
  Load --> FP & OV
  InvT --> Pos
  ShipT -- "in transit" --> Pos
  Pos --> IP & OV
  ShipT -- "dispatch −qty at origin<br/>receipt +qty at destination" --> InvT
  InvT --> Short --> AlertT --> IP
```

The forecasting results are precomputed and served as they are; the API does not train or run a model. In demo
mode the dashboard uses the same files bundled into the build; in live mode it reads them from the API and shows an
error, not the bundled copy, when the API cannot provide them.

## 9. Fabric network topology

```mermaid
flowchart TB
  subgraph OrdererOrg["OrdererOrg"]
    O["orderer.example.com:7050<br/>Raft, 1 node · BatchTimeout 500 ms"]
    CAO["ca_orderer :9054"]
  end
  subgraph Org1["Org1MSP — issuing organization"]
    P1["peer0.org1.example.com:7051"]
    CC1["peer0org1_wethaq_ccaas<br/>chaincode as a service :9999"]
    CA1["ca_org1 :7054"]
    ID1[["wethaq-app (client)"]]
  end
  subgraph Org2["Org2MSP — receiving organization"]
    P2["peer0.org2.example.com:9051"]
    CC2["peer0org2_wethaq_ccaas<br/>chaincode as a service :9999"]
    CA2["ca_org2 :8054"]
    ID2[["wethaq-app (client)"]]
  end
  Ch{{"channel: wethaq<br/>chaincode: wethaq<br/>endorsement: AND(Org1MSP.peer, Org2MSP.peer)"}}
  API["Wethaq API<br/>(Fabric Gateway)"]
  P1 --- CC1
  P2 --- CC2
  P1 --- Ch
  P2 --- Ch
  O --- Ch
  CA1 -. enrolls .-> ID1
  CA2 -. enrolls .-> ID2
  API -- "Org1 operations (request, dispatch, in transit)" --> P1
  API -- "Org2 operations (receipt)" --> P2
  API -. signs as .-> ID1
  API -. signs as .-> ID2
```

Every transaction needs an endorsement from a peer of each organization before the orderer puts it in a block.
This is the fabric-samples test network on one machine: one peer per organization and one orderer, so it shows the
permissioned workflow but is not a fault-tolerant production network.

## 10. Shipment lifecycle

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Requested: RegisterRequest (Org1, Planner)
  Requested --> Dispatched: Dispatch (Org1, Dispatcher), 1 to requested qty
  Dispatched --> InTransit: MarkInTransit (Org1, Dispatcher)
  Dispatched --> Received: Receive (Org2, Receiver), 1 to dispatched qty
  InTransit --> Received: Receive (Org2, Receiver), 1 to dispatched qty
  Dispatched --> PartiallyReceived: ReceivePartial (Org2, Receiver), less than outstanding
  InTransit --> PartiallyReceived: ReceivePartial (Org2, Receiver), less than outstanding
  PartiallyReceived --> PartiallyReceived: ReceivePartial, less than outstanding
  PartiallyReceived --> Received: Receive (Org2, Receiver), 1 to outstanding qty
  Requested --> Cancelled: Cancel (Org1, Dispatcher)
  Dispatched --> Cancelled: Cancel (Org1, Dispatcher)
  Received --> Returned: Return (Org2, Receiver), 1 to received qty
  Received --> [*]
  Cancelled --> [*]
  Returned --> [*]
  InTransit: In Transit
  PartiallyReceived: Partially Received
  note right of Received
    Any other step is rejected by the chaincode and
    recorded as a Rejected transaction with the failed rule:
    authorizedOrg · validReference · validQuantity ·
    validTransition · noDuplicate
  end note
```

Partial receipts, cancellation and returns were added in chaincode version 2 (GP2) and are offered in live mode only. A final receipt that leaves the total below the dispatched quantity is accepted and raises a *Receipt quantity mismatch* alert. A role
that may not perform an operation is refused by the API before anything reaches the ledger; that attempt is stored
off-chain as a rejected attempt with an alert and an audit entry.
