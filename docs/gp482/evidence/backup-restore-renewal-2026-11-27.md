# Identity renewal, PostgreSQL backup/restore and catch-up — 2026-11-27

Real Fabric test network (Fabric 2.5.12, CA 1.5.15), API in `LEDGER_MODE=fabric`, PostgreSQL 16. Commands and
output as run; output trimmed only where marked.

## 1. Renewal of the application identities

```
$ openssl x509 -in fabric/identities/org1/wethaq-app/msp/signcerts/cert.pem -noout -serial -enddate
serial=1601D9DD15B86C9FB7177A93A4F25E30F6E92D71
notAfter=Nov 27 18:24:00 2027 GMT
$ ./fabric/renew-identities.sh 1
Org1MSP: renewed wethaq-app (was valid until Nov 27 18:24:00 2027 GMT; now Nov 27 18:40:00 2027 GMT); previous identity kept in wethaq-app.20261127T184010Z
$ openssl x509 … -serial -enddate
serial=0E4ABD6F58D91EF737AA17AD18B3080B311B4B82
notAfter=Nov 27 18:40:00 2027 GMT
# public key of the new private key = public key in the new certificate (md5 of the PEM):
f0452a0b7af9a229210f3f3a7dbd7021 / f0452a0b7af9a229210f3f3a7dbd7021
# public key of the previous (kept) private key:
e3f236c515963fc90d3f5ad1a1718f61
$ ./fabric/renew-identities.sh 2
Org2MSP: renewed wethaq-app (was valid until Nov 27 18:24:00 2027 GMT; now Nov 27 18:40:00 2027 GMT); previous identity kept in wethaq-app.20261127T184014Z
$ ./fabric/verify-network.sh   (last lines)
  ok   Org1MSP wethaq-app certificate valid for 30+ days
  ok   Org2MSP wethaq-app certificate valid for 30+ days
```

## 2. Backup and restore of PostgreSQL

```
$ pg_dump --format=custom --no-owner postgres://…/wethaq -f /tmp/wethaq.dump     (71184 bytes)
$ createdb wethaq_restore; pg_restore --no-owner -d postgres://…/wethaq_restore /tmp/wethaq.dump
            shipments | ledger_records | alerts | event checkpoint block
wethaq          53    |      146       |   27   |  43
wethaq_restore  53    |      146       |   27   |  43
```

## 3. A transaction after the backup reaches the restored copy

The API was started on the original database (with the renewed identities) and dispatched a shipment; then it was
stopped and an API was started on the restored copy.

```
shipment SHP-2026-0001 qty 5
{"passed":true,"source":"chaincode","transactionId":"TX-A6D303D36F93","txId":"a6d303d3…8e4b","block":44,"ledgerState":"confirmed"}
restored copy before catch-up: Requested
restored copy after the API started on it: Dispatched
event checkpoint of the restored copy: 44
```

Not exercised: archiving and restoring the Fabric Docker volumes, and certificate revocation (see DEPLOYMENT.md §5, §8).
