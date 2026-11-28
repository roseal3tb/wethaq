# Generates openapi.json (OpenAPI 3) for the Wethaq API. Run: python3 scripts/openapi.py
# test/sync.test.ts fails if a route registered by the app is missing from the document.
import json
ref=lambda n:{"$ref":f"#/components/schemas/{n}"}
def resp(desc, schema=None):
    r={"description":desc}
    if schema: r["content"]={"application/json":{"schema":schema}}
    return r
err=resp("Error",ref("Error"))
auth=[{"bearerAuth":[]}]
idem={"name":"Idempotency-Key","in":"header","required":False,"schema":{"type":"string","pattern":"^[A-Za-z0-9._:-]{8,128}$"},"description":"Repeating a request with the same key returns the stored result instead of submitting again."}
sid={"name":"id","in":"path","required":True,"schema":{"type":"string","pattern":"^[A-Za-z0-9-]{1,64}$"}}
ledger_responses={"200":resp("Case A: committed and accepted by the chaincode",ref("LedgerResult")),
 "202":resp("Case C (unknown): submitted, the ledger has not confirmed it yet; applied automatically later",ref("Pending")),
 "409":resp("Conflict: invalidated by the peers (for example MVCC), or the shipment's registration is still pending",ref("Error")),
 "422":resp("Case B: rejected by the chaincode (recorded on the ledger) or by the application role check (off-chain)",ref("LedgerResult")),
 "502":resp("Case C (definite): the peers did not endorse it; nothing was recorded",ref("Error")),
 "503":resp("Case C (definite): the ledger is not reachable; nothing was recorded",ref("Error")),
 "401":err,"403":err}
def op(summary, tag, responses, secured=True, params=None, body=None, desc=None):
    o={"summary":summary,"tags":[tag],"responses":responses}
    if desc: o["description"]=desc
    if secured: o["security"]=auth
    if params: o["parameters"]=params
    if body: o["requestBody"]={"required":True,"content":{"application/json":{"schema":body}}}
    return o
obj=lambda props,req=None:{"type":"object","properties":props,**({"required":req} if req else {})}
S={"type":"string"}; I={"type":"integer"}; B={"type":"boolean"}
paths={
 "/health":{"get":op("Basic health","Health",{"200":resp("Database reachable")},False)},
 "/health/live":{"get":op("Liveness","Health",{"200":resp("Process running")},False)},
 "/health/ready":{"get":op("Readiness: database and ledger","Health",{"200":resp("Ready",ref("Ready")),"503":resp("Not ready",ref("Ready"))},False)},
 "/openapi.json":{"get":op("This document","Health",{"200":resp("OpenAPI 3 document")},False)},
 "/auth/login":{"post":op("Sign in","Auth",{"200":resp("Session",ref("Session")),"400":err,"401":err,"429":err},False,body=obj({"email":S,"password":S},["email","password"]),desc="10 attempts per minute per client.")},
 "/auth/me":{"get":op("Current user","Auth",{"200":resp("User"),"401":err})},
 "/auth/password":{"post":op("Change own password","Auth",{"200":resp("New session",ref("Session")),"400":err,"401":err},body=obj({"currentPassword":S,"newPassword":S},["currentPassword","newPassword"]))},
 "/auth/logout":{"post":op("Sign out: the token used is refused from then on (a password change or reset ends every session)","Auth",{"200":resp("Signed out"),"401":err})},
 "/auth/switch":{"post":op("Switch to a demonstration account (development only)","Auth",{"200":resp("Session",ref("Session")),"403":err},body=obj({"role":{"type":"string","enum":["Planner","Dispatcher","Receiver","Admin"]}},["role"]),desc="Always disabled when NODE_ENV=production.")},
 "/events":{"get":op("Live changes (server-sent events)","Live",{"200":{"description":"text/event-stream of change events","content":{"text/event-stream":{"schema":ref("LiveEvent")}}}})},
 "/state":{"get":op("Dashboard state","Data",{"200":resp("Shipments, transactions, alerts, users and inventory positions")})},
 "/inventory":{"get":op("Inventory positions from PostgreSQL","Data",{"200":resp("Positions",{"type":"array","items":ref("InventoryPosition")})},params=[{"name":"partId","in":"query","schema":S},{"name":"location","in":"query","schema":{"type":"string","enum":["LOC-CW","LOC-DC","LOC-DS"]}}])},
 "/analytics":{"get":op("List analysis results and their provenance","Analytics",{"200":resp("List")})},
 "/analytics/{name}":{"get":op("One analysis result, unchanged, with provenance","Analytics",{"200":resp("Result",ref("Analytics")),"404":err,"503":err},params=[{"name":"name","in":"path","required":True,"schema":{"type":"string","enum":["assessment","forecasts","raf-parts","rolling","inventory-simulation"]}}])},
 "/shipments":{"post":op("Create a shipment request (Planner); registered on the ledger","Shipments",{"201":resp("Registered",ref("Created")),**{k:v for k,v in ledger_responses.items() if k!="200" and k!="422"},"400":err},params=[idem],body=obj({"partId":{"type":"string","pattern":"^SP-\\d{3}$"},"location":{"type":"string","enum":["Central Warehouse","Distribution Center","Deployment Site"]},"qty":{"type":"integer","minimum":1,"maximum":100000},"month":{"type":"string","pattern":"^\\d{4}-\\d{2}$"},"note":{"type":"string","maxLength":1000}},["partId","location","qty","month","note"]))},
}
for o,who in [("dispatch","Dispatcher (Org1)"),("transit","Dispatcher (Org1)"),("receive","Receiver (Org2)")]:
    paths[f"/shipments/{{id}}/{o}"]={"post":op(f"Record a {o} — {who}","Shipments",ledger_responses,params=[sid,idem],body=obj({"qty":{"type":"integer"},"note":{"type":"string","maxLength":1000}}))}
# Chaincode version 2 (GP2, B5)
for path,summary in [("receive-partial","Record part of a receipt; the shipment stays open — Receiver (Org2)"),("cancel","Cancel a shipment that is Requested or Dispatched — Dispatcher (Org1)"),("return","Return received items to the origin — Receiver (Org2)")]:
    paths[f"/shipments/{{id}}/{path}"]={"post":op(summary,"Shipments",ledger_responses,params=[sid,idem],body=obj({"qty":{"type":"integer"},"note":{"type":"string","maxLength":1000}}))}
paths["/shipments/{id}/verify"]={"get":op("Compare the PostgreSQL copy with the ledger (VerifyShipment on the peer in Fabric mode)","Shipments",{"200":resp("Verification",ref("Verify")),"404":err},params=[sid])}
paths["/demo/invalid"]={"post":op("Run a rejection demonstration against the chaincode (development only)","Demo",{"422":resp("Rejected",ref("LedgerResult")),"400":err,"403":err,"409":err},body=obj({"scenario":{"type":"string","enum":["Duplicate receipt","Unauthorized organization","Invalid status transition","Quantity exceeds dispatched","Unknown shipment reference"]},"shipmentId":S},["scenario"]),desc="Disabled when NODE_ENV=production or DEMO_TOOLS=false.")}
paths["/alerts/{id}/ack"]={"post":op("Acknowledge an alert","Alerts",{"200":resp("ok"),"404":err},params=[{"name":"id","in":"path","required":True,"schema":S}],body=obj({"note":S}))}
paths["/users"]={"post":op("Add a user (Admin); returns a one-time temporary password","Users",{"201":resp("User"),"400":err,"403":err})}
paths["/users/{id}"]={"patch":op("Change a user's role or active flag (Admin)","Users",{"200":resp("User"),"400":err,"403":err,"404":err},params=[{"name":"id","in":"path","required":True,"schema":S}])}
paths["/users/{id}/reset-password"]={"post":op("Issue a new temporary password (Admin)","Users",{"200":resp("User"),"403":err,"404":err},params=[{"name":"id","in":"path","required":True,"schema":S}])}
paths["/admin/sync-status"]={"get":op("Ledger synchronization status (Admin)","Admin",{"200":resp("Status",ref("SyncStatus")),"403":err})}
paths["/admin/reconcile"]={"post":op("Reconcile pending ledger operations now (Admin)","Admin",{"200":resp("Report",ref("Reconcile")),"403":err})}
qp=lambda n,schema,desc=None:{"name":n,"in":"query","required":False,"schema":schema,**({"description":desc} if desc else {})}
en=lambda *v:{"type":"string","enum":list(v)}
page_params=[qp("limit",{"type":"integer","minimum":1,"maximum":200,"default":50},"Page size"),qp("offset",{"type":"integer","minimum":0,"default":0},"Entries to skip")]
page=lambda desc:{"200":resp(desc,ref("Page")),"400":err,"401":err}
paths["/shipments"]["get"]=op("List shipments, newest first (paginated)","Shipments",page("A page of shipments (dashboard Shipment objects with their timeline)"),
  params=[qp("status",en("Requested","Dispatched","In Transit","Partially Received","Received","Cancelled","Returned")),qp("partId",{"type":"string","pattern":"^SP-\\d{3}$"}),qp("location",S,"Destination name or id"),qp("ledgerState",en("pending","confirmed","failed"))]+page_params)
paths["/shipments/{id}"]={"get":op("Traceability of one shipment: timeline, ledger records, rejected attempts, alerts, ledger operations and the ledger's own history","Shipments",{"200":resp("Shipment trace"),"400":err,"401":err,"404":err},params=[sid,qp("ledger",en("true","false"),"false skips reading the history from the ledger")])}
paths["/ledger/records"]={"get":op("Reporting copy of ledger records and application-level rejections, newest first (paginated)","Ledger",page("A page of ledger records"),
  params=[qp("shipmentId",S),qp("type",en("REQUEST","DISPATCH","STATUS_CHANGE","RECEIPT","PARTIAL_RECEIPT","CANCELLATION","RETURN","ATTEMPT")),qp("status",en("Committed","Rejected")),qp("source",en("chaincode","application")),qp("from",{"type":"string","format":"date-time"},"On or after (ISO 8601)"),qp("to",{"type":"string","format":"date-time"},"Before (ISO 8601)")]+page_params)}
paths["/alerts"]={"get":op("List alerts, newest first (paginated)","Alerts",page("A page of alerts"),
  params=[qp("acknowledged",en("true","false")),qp("type",en("Shortage","Discrepancy","Delay","Rejected attempt","Ledger sync","Pending transaction")),qp("severity",en("Critical","High","Medium","Low")),qp("shipmentId",S),qp("partId",S)]+page_params)}
paths["/admin/audit"]={"get":op("Application audit log, newest first (Admin); append-only in the database","Admin",{"200":resp("Entries"),"400":err,"403":err},params=[qp("limit",{"type":"integer","minimum":1,"maximum":500,"default":100}),qp("before",{"type":"integer","minimum":1},"Id of the last entry of the previous page"),qp("action",S,"For example auth.login"),qp("outcome",en("ok","denied","rejected","failed","pending")),qp("userId",S),qp("target",S)])}
paths["/admin/consistency"]={"get":op("Compare every shipment in PostgreSQL with the ledger, and the event checkpoint with the ledger height (Admin, read-only)","Admin",{"200":resp("Consistency report",ref("Consistency")),"401":err,"403":err})}
schemas={
 "Error":obj({"error":S,"ledgerFailure":{"type":"string","enum":["unavailable","endorsement","invalid","error"]},"ledgerState":{"type":"string","enum":["failed"]},"txId":S},["error"]),
 "Session":obj({"token":S,"user":{"type":"object"},"demoRoleSwitch":B,"ledger":{"type":"string","enum":["local","fabric"]}}),
 "LedgerResult":obj({"passed":B,"source":{"type":"string","enum":["chaincode","application"]},"failure":S,"failedRule":{"type":"string","enum":["authorizedOrg","validReference","noDuplicate","validQuantity","validTransition"]},"reason":S,"transactionId":S,"txId":{"type":"string","description":"64-hex ledger transaction id (absent for application-level rejections)"},"block":I,"ledgerState":S},["passed","transactionId"]),
 "Pending":obj({"pending":{"type":"boolean","enum":[True]},"ledgerState":{"type":"string","enum":["pending"]},"operationId":S,"txId":S,"transactionId":S,"id":S,"message":S},["pending","operationId"]),
 "Created":obj({"id":S,"txId":S,"transactionId":S,"block":I,"ledgerState":S},["id"]),
 "Verify":obj({"shipmentId":S,"status":{"type":"string","enum":["verified","mismatch","not_found","pending","ledger_unavailable","failed"]},"onLedger":B,"match":B,"differences":{"type":"array","items":S},"lastTxId":{"type":"string","nullable":True},"ledgerState":S,"ledgerKind":S,"checkedAt":S,"note":S,"ledger":{"type":"object"},"history":{"type":"array","items":{"type":"object"}}},["shipmentId","status","match","differences"]),
 "InventoryPosition":obj({"id":S,"partId":S,"location":S,"onHand":I,"inTransit":I,"monthlyDemand":{"type":"number"},"leadDays":I,"safetyStock":I,"reorderPoint":I,"leadDemand":{"type":"number"},"daysCover":{"type":"number"},"status":{"type":"string","enum":["Healthy","Watch","Below reorder point","Stockout risk"]},"recommended":I,"updatedAt":S}),
 "Analytics":obj({"data":{},"provenance":obj({"artifact":S,"file":S,"script":S,"dataset":S,"description":S,"generatedAt":S,"sha256":S,"bytes":I,"note":S})}),
 "Ready":obj({"ok":B,"ledger":S,"database":obj({"ok":B,"detail":S}),"ledgerHealth":obj({"ok":B,"detail":S,"identities":{"type":"array","items":obj({"msp":S,"subject":S,"expires":S,"daysLeft":I})}})}),
 "SyncStatus":obj({"ledger":S,"checkpoint":{"type":"object","nullable":True},"operations":{"type":"object","additionalProperties":I},"open":{"type":"array","items":{"type":"object"}},"lastReconcile":{"type":"object","nullable":True},"consumer":obj({"running":B,"lastEventAt":{"type":"string","nullable":True},"lastError":{"type":"string","nullable":True},"checkpointReset":{"type":"object","nullable":True,"description":"Set when the checkpoint was found ahead of the ledger at startup","properties":{"at":S,"fromBlock":I,"toBlock":I,"ledgerHeight":I,"reason":S}}})}),
 "Page":obj({"items":{"type":"array","items":{"type":"object"}},"total":{"type":"integer","description":"Entries matching the filters"},"limit":I,"offset":I},["items","total","limit","offset"]),
 "Consistency":obj({"checkedAt":S,"ledger":{"type":"string","enum":["local","fabric"]},"ledgerHeight":{"type":"integer","nullable":True},
   "checkpoint":{"type":"object","nullable":True,"properties":{"block":I,"txId":{"type":"string","nullable":True},"aheadOfLedger":B}},"consistent":B,
   "summary":obj({k:I for k in ["shipments","verified","mismatch","notFound","pending","failed","unavailable","recordsMissingOnLedger","recordsMissingInDatabase","orphanRecordsChecked","orphanRecordsMissingOnLedger"]}),
   "problems":{"type":"array","items":obj({"shipmentId":S,"status":S,"differences":{"type":"array","items":S},"missingOnLedger":{"type":"array","items":S},"missingInDatabase":{"type":"array","items":S}})},
   "orphanRecordsMissingOnLedger":{"type":"array","items":S},"truncated":B}),
 "Reconcile":obj({"at":S,"checked":I,"applied":I,"failed":I,"stillPending":I,"errors":{"type":"array","items":S}}),
 "LiveEvent":obj({"kind":{"type":"string","enum":["ledger","app"]},"name":S,"shipmentId":S,"txId":S,"block":I,"status":S,"operation":S,"at":S}),
}
v1=lambda summary, params=None, extra=None: {"get":op(summary,"Analytics",{"200":resp("Result (version, data, sources with SHA-256)",ref("AnalyticsV1")),"400":err,"401":err,"404":err,"503":err,**(extra or {})},params=params)}
q=lambda n,enum=None,desc=None:{"name":n,"in":"query","required":False,"schema":({"type":"string","enum":enum} if enum else {"type":"string"}),**({"description":desc} if desc else {})}
paths["/analytics/v1/datasets"]=v1("The RAF (real) and synthetic datasets, kept separate, with their data checks")
paths["/analytics/v1/methods"]=v1("Forecasting methods and settings actually used")
paths["/analytics/v1/parts"]=v1("The 40 exported RAF parts",[q("class",["Intermittent","Lumpy"]),q("q",desc="Part id contains")])
paths["/analytics/v1/parts/{id}/forecast"]=v1("History, test-window forecasts and projection of one RAF part",[{"name":"id","in":"path","required":True,"schema":{"type":"string","example":"RAF0000"}},q("method",["naive","croston","tsb","gbm"]),{"name":"horizon","in":"query","required":False,"schema":{"type":"integer","minimum":1,"maximum":6},"description":"Projection months; only 6 were produced"}])
paths["/analytics/v1/metrics"]=v1("Holdout accuracy by method",[q("dataset",["RAF","SYN"]),q("split",["test","validation"]),q("method",desc="Exact method name from /methods")])
paths["/analytics/v1/classification"]=v1("Demand classes and accuracy by class")
paths["/analytics/v1/model-comparison"]=v1("All methods on all 5,000 RAF parts, test window")
paths["/analytics/v1/rolling"]=v1("Rolling-origin evaluation",[q("method")])
paths["/analytics/v1/inventory-simulation"]=v1("Inventory policy simulation (synthetic panel)",[q("policy"),q("class")])
paths["/analytics/v1/inventory-policies"]=v1("Headline result per inventory policy (synthetic panel)")
paths["/analytics/v1/provenance"]=v1("Provenance of every result file")
schemas["AnalyticsV1"]=obj({"version":{"type":"string","enum":["v1"]},"data":{},"sources":{"type":"array","items":{"type":"object"}},"limitations":{"type":"array","items":S}},["version","data","sources"])

doc={"openapi":"3.0.3","info":{"title":"Wethaq API","version":"0.4.0","description":"Application service for Wethaq (GP482): Express + PostgreSQL, with shipment rules enforced by the Hyperledger Fabric chaincode (or, in development, by the local development ledger, which is not Fabric). All routes are under /api."},
 "servers":[{"url":"/api"}],"components":{"securitySchemes":{"bearerAuth":{"type":"http","scheme":"bearer","bearerFormat":"JWT"}},"schemas":schemas},"paths":paths}
import os
json.dump(doc,open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','openapi.json'),'w'),indent=2)
print('wrote openapi.json')

