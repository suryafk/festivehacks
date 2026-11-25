# NudgeBee: festive-surge remediation workflow

The incident we want NudgeBee to handle: on a Diwali-eve spike, `pool-watcher` pods in namespace `marg-bandhu`
get **OOMKilled** (they build a route-corridor index for every request in their batch). Users stop getting
"someone joined your pool" alerts exactly when they need them most.

## 1. Install the agent on the k3s cluster

1. Sign up at NudgeBee and add a cluster. Copy the Helm command it shows (it contains your agent token).
2. On the VM, run that command (it is a `helm install` of the NudgeBee agent). The docs for local clusters:
   https://docs.nudgebee.com/docs/installation/agent/installation/
3. Check the agent pods are running: `kubectl get pods -A | grep -i nudgebee`.

## 2. Build the workflow (Workflow Builder)

Trigger: Kubernetes event / alert for `OOMKilled` (or `CrashLoopBackOff`) on deployment `pool-watcher`, namespace `marg-bandhu`.

| # | Task | Config |
|---|------|--------|
| 1 | **AI investigation (RCA)** | Run root-cause analysis on the failing pod. Expected finding: memory limit 256Mi exceeded while matching a large batch. |
| 2 | **HTTP request → Marg Bandhu** | `POST https://<HOST>/api/ops/nudgebee?token=<OPS_TOKEN>` body `{"action":"rca","summary":"<RCA summary>"}` so it shows on `/ops` |
| 3 | **Approval** | Human approval: "Scale pool-watcher to 4 and enable degrade_gracefully?" |
| 4 | **Kubernetes task: scale** | Scale deployment `marg-bandhu/pool-watcher` to `4` replicas |
| 5 | **HTTP request → Flagsmith** | Turn on `degrade_gracefully` (see below) |
| 6 | **HTTP request → Marg Bandhu** | `POST https://<HOST>/api/ops/nudgebee?token=<OPS_TOKEN>` body `{"action":"remediated","summary":"Scaled pool-watcher to 4, degrade_gracefully ON"}` |
| 7 | **Notify** | Discord channel (optional) |

### Flagsmith call (step 5)

Find the feature-state id once:

```bash
curl -s -H "Authorization: Api-Key $FLAGSMITH_ADMIN_API_KEY" \
  "https://api.flagsmith.com/api/v1/environments/$FLAGSMITH_ENVIRONMENT_KEY/featurestates/?feature_name=degrade_gracefully"
```

Then the workflow's HTTP task:

```
PATCH https://api.flagsmith.com/api/v1/environments/<FLAGSMITH_ENVIRONMENT_KEY>/featurestates/<featurestate_id>/
Authorization: Api-Key <FLAGSMITH_ADMIN_API_KEY>
Content-Type: application/json

{"enabled": true}
```

The API and the watchers pick the flag up on their next poll (a few seconds), and watchers drop from batch 50 to batch 5 at half the pace.
Memory drops from ~600 MB to ~160 MB per pod, so pods stop crashing and the queue drains.

## 3. Demo script

1. Open `https://<HOST>/#/ops`. Show 2 healthy watcher pods.
2. Click **Simulate Diwali-eve surge** (1,500 pool requests).
3. Pods go red ("gone (restarted / OOMKilled)") and new pod names appear as Kubernetes restarts them. `kubectl -n marg-bandhu get pods -w` shows `OOMKilled`.
4. In NudgeBee: the RCA, then approve. The `/ops` timeline shows the NudgeBee events, the flag flips to ON, and the queue drains.
5. Reset: turn `degrade_gracefully` off in Flagsmith and click **Clear surge**.

Fallback if the agent can't be installed in time: trigger the same workflow manually from NudgeBee, and use
`POST /api/ops/override` (with `x-ops-token`) to flip the degrade flag locally.
