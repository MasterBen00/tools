import { load } from "js-yaml";
import { toString as cronToString } from "cronstrue";

/* Kubernetes manifest analysis: plain-English summaries plus required-field and best-practice checks. */

export type Severity = "error" | "warning" | "info";
export interface Issue {
    severity: Severity;
    message: string;
    path?: string;
}
export interface DocResult {
    /** 1-based document number in the paste. */
    index: number;
    /** 1-based line where the document starts. */
    line: number;
    kind: string;
    apiVersion: string;
    name: string;
    namespace: string;
    summary: string[];
    issues: Issue[];
    parseError?: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const obj = (v: unknown): Obj | undefined => (isObj(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const labelsText = (l: Obj | undefined) =>
    l && Object.keys(l).length ? Object.entries(l).map(([k, v]) => `${k}=${str(v)}`).join(", ") : "";

// --- apiVersion checks -------------------------------------------------------------------------------

/** Expected stable apiVersion per kind. */
const STABLE: Record<string, string> = {
    Deployment: "apps/v1",
    StatefulSet: "apps/v1",
    DaemonSet: "apps/v1",
    ReplicaSet: "apps/v1",
    Service: "v1",
    Pod: "v1",
    ConfigMap: "v1",
    Secret: "v1",
    Namespace: "v1",
    ServiceAccount: "v1",
    PersistentVolumeClaim: "v1",
    PersistentVolume: "v1",
    Ingress: "networking.k8s.io/v1",
    IngressClass: "networking.k8s.io/v1",
    NetworkPolicy: "networking.k8s.io/v1",
    Job: "batch/v1",
    CronJob: "batch/v1",
    HorizontalPodAutoscaler: "autoscaling/v2",
    PodDisruptionBudget: "policy/v1",
    Role: "rbac.authorization.k8s.io/v1",
    RoleBinding: "rbac.authorization.k8s.io/v1",
    ClusterRole: "rbac.authorization.k8s.io/v1",
    ClusterRoleBinding: "rbac.authorization.k8s.io/v1",
    CustomResourceDefinition: "apiextensions.k8s.io/v1",
};

const DEPRECATED: Record<string, string> = {
    "extensions/v1beta1": "removed in Kubernetes 1.16 (workloads) and 1.22 (Ingress)",
    "apps/v1beta1": "removed in Kubernetes 1.16",
    "apps/v1beta2": "removed in Kubernetes 1.16",
    "networking.k8s.io/v1beta1": "removed in Kubernetes 1.22",
    "batch/v1beta1": "removed in Kubernetes 1.25",
    "policy/v1beta1": "removed in Kubernetes 1.25",
    "autoscaling/v2beta1": "removed in Kubernetes 1.25",
    "autoscaling/v2beta2": "removed in Kubernetes 1.26",
    "rbac.authorization.k8s.io/v1beta1": "removed in Kubernetes 1.22",
    "apiextensions.k8s.io/v1beta1": "removed in Kubernetes 1.22",
    "admissionregistration.k8s.io/v1beta1": "removed in Kubernetes 1.22",
    "storage.k8s.io/v1beta1": "partly removed in Kubernetes 1.22",
};

function checkApiVersion(kind: string, apiVersion: string, issues: Issue[]) {
    if (!apiVersion) return;
    if (kind === "PodSecurityPolicy") {
        issues.push({ severity: "error", path: "kind", message: "PodSecurityPolicy was removed in Kubernetes 1.25. Use Pod Security Admission (namespace labels pod-security.kubernetes.io/enforce) or a policy engine instead." });
        return;
    }
    const dep = DEPRECATED[apiVersion];
    const stable = STABLE[kind];
    if (dep) {
        issues.push({ severity: "error", path: "apiVersion", message: `apiVersion ${apiVersion} is deprecated and ${dep}.${stable ? ` Use ${stable} for ${kind}.` : ""}` });
        return;
    }
    if (stable && apiVersion !== stable && !(kind === "HorizontalPodAutoscaler" && apiVersion === "autoscaling/v1")) {
        issues.push({ severity: "warning", path: "apiVersion", message: `Unexpected apiVersion ${apiVersion} for ${kind}; the stable version is ${stable}.` });
    }
}

// --- containers --------------------------------------------------------------------------------------

interface ImageInfo { ref: string; repo: string; tag: string; digest: boolean }
function parseImage(ref: string): ImageInfo {
    const digest = ref.includes("@sha256:");
    const noDigest = ref.split("@")[0];
    const lastSlash = noDigest.lastIndexOf("/");
    const last = noDigest.slice(lastSlash + 1);
    const colon = last.indexOf(":");
    const tag = colon >= 0 ? last.slice(colon + 1) : "";
    const repo = colon >= 0 ? noDigest.slice(0, lastSlash + 1 + colon) : noDigest;
    return { ref, repo, tag, digest };
}

const SECRET_NAME = /(pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|credentials?|auth)$/i;
const SECRET_VALUE = /^(AKIA[0-9A-Z]{16}|eyJ[\w-]+\.[\w-]+\.[\w-]+|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[\w-]+)$/;

interface PodInfo {
    containers: Obj[];
    images: string[];
    ports: { name: string; port: number; protocol: string }[];
}

function checkPodSpec(spec: Obj | undefined, base: string, kind: string, issues: Issue[]): PodInfo {
    const info: PodInfo = { containers: [], images: [], ports: [] };
    if (!spec) {
        issues.push({ severity: "error", path: base, message: "Pod spec is missing." });
        return info;
    }
    const longRunning = !["Job", "CronJob"].includes(kind);
    const containers = arr(spec.containers).filter(isObj);
    info.containers = containers;
    if (!containers.length) issues.push({ severity: "error", path: `${base}.containers`, message: "At least one container is required." });

    const podSc = obj(spec.securityContext);
    const podNonRoot = podSc?.runAsNonRoot === true || (typeof podSc?.runAsUser === "number" && podSc.runAsUser > 0);

    if (spec.hostNetwork === true) issues.push({ severity: "warning", path: `${base}.hostNetwork`, message: "hostNetwork: true shares the node network namespace; the pod can see and bind node ports." });
    if (spec.hostPID === true) issues.push({ severity: "warning", path: `${base}.hostPID`, message: "hostPID: true lets the pod see every process on the node." });
    if (spec.hostIPC === true) issues.push({ severity: "warning", path: `${base}.hostIPC`, message: "hostIPC: true shares the node IPC namespace." });
    arr(spec.volumes).filter(isObj).forEach((v, i) => {
        const hp = obj(v.hostPath);
        if (hp) issues.push({ severity: "warning", path: `${base}.volumes[${i}].hostPath`, message: `Volume ${str(v.name) || i} mounts hostPath ${str(hp.path)} from the node; this breaks isolation and ties the pod to a node.` });
    });
    if (!longRunning) {
        const rp = str(spec.restartPolicy);
        if (rp !== "OnFailure" && rp !== "Never")
            issues.push({ severity: "error", path: `${base}.restartPolicy`, message: `Jobs need restartPolicy OnFailure or Never${rp ? ` (found ${rp})` : " (the default Always is rejected)"}.` });
    }

    const all: [Obj, string, boolean][] = [
        ...arr(spec.initContainers).filter(isObj).map((c, i): [Obj, string, boolean] => [c, `${base}.initContainers[${i}]`, true]),
        ...containers.map((c, i): [Obj, string, boolean] => [c, `${base}.containers[${i}]`, false]),
    ];
    for (const [c, p, init] of all) {
        const cname = str(c.name);
        const label = cname ? `Container ${cname}` : "Container";
        if (!cname) issues.push({ severity: "error", path: `${p}.name`, message: "Container name is required." });
        const image = str(c.image);
        if (!image) issues.push({ severity: "error", path: `${p}.image`, message: `${label} has no image.` });
        else {
            if (!init) info.images.push(image);
            const im = parseImage(image);
            if (!im.digest && !im.tag) issues.push({ severity: "warning", path: `${p}.image`, message: `${label}: image ${image} has no tag, so it resolves to latest. Pin a version (e.g. ${im.repo}:1.2.3) or a digest.` });
            else if (!im.digest && im.tag === "latest") issues.push({ severity: "warning", path: `${p}.image`, message: `${label}: image ${image} uses the latest tag; deployments are not reproducible and rollbacks may not change anything. Pin a version or digest.` });
            else if (str(c.imagePullPolicy) === "Always" && im.tag !== "latest") issues.push({ severity: "info", path: `${p}.imagePullPolicy`, message: `${label}: imagePullPolicy Always with a pinned tag re-checks the registry on every start; IfNotPresent is usually enough for immutable tags.` });
        }
        if (!init) {
            for (const port of arr(c.ports).filter(isObj)) {
                const n = Number(port.containerPort);
                if (!Number.isInteger(n) || n < 1 || n > 65535) issues.push({ severity: "error", path: `${p}.ports`, message: `${label}: containerPort ${str(port.containerPort) || "(missing)"} is not a valid port.` });
                else info.ports.push({ name: str(port.name), port: n, protocol: str(port.protocol) || "TCP" });
            }
        }
        const res = obj(c.resources);
        const req = obj(res?.requests);
        const lim = obj(res?.limits);
        if (!req && !lim) issues.push({ severity: "warning", path: `${p}.resources`, message: `${label} has no resource requests or limits; the scheduler cannot place it well and it can starve neighbours.` });
        else {
            if (!req) issues.push({ severity: "warning", path: `${p}.resources.requests`, message: `${label} has limits but no requests (requests default to the limits).` });
            if (!lim) issues.push({ severity: "warning", path: `${p}.resources.limits`, message: `${label} has requests but no limits.` });
            else if (!lim.memory) issues.push({ severity: "info", path: `${p}.resources.limits.memory`, message: `${label} has no memory limit.` });
        }
        if (longRunning && !init) {
            if (!c.livenessProbe) issues.push({ severity: "warning", path: `${p}.livenessProbe`, message: `${label} has no livenessProbe; a hung process will never be restarted.` });
            if (!c.readinessProbe) issues.push({ severity: "warning", path: `${p}.readinessProbe`, message: `${label} has no readinessProbe; traffic is sent before the app is ready.` });
        }
        const sc = obj(c.securityContext);
        if (!sc && !podSc) issues.push({ severity: "warning", path: `${p}.securityContext`, message: `${label} has no securityContext (pod or container); it probably runs as root. Set runAsNonRoot: true and allowPrivilegeEscalation: false.` });
        else {
            if (sc?.privileged === true) issues.push({ severity: "warning", path: `${p}.securityContext.privileged`, message: `${label} runs privileged; it has full access to the host.` });
            if (sc?.runAsUser === 0 || (sc?.runAsUser === undefined && podSc?.runAsUser === 0)) issues.push({ severity: "warning", path: `${p}.securityContext.runAsUser`, message: `${label} explicitly runs as root (runAsUser: 0).` });
            else if (sc?.runAsNonRoot !== true && !(typeof sc?.runAsUser === "number" && sc.runAsUser > 0) && !podNonRoot)
                issues.push({ severity: "warning", path: `${p}.securityContext.runAsNonRoot`, message: `${label} may run as root; set runAsNonRoot: true (and a non-zero runAsUser).` });
            if (sc?.allowPrivilegeEscalation !== false && sc?.privileged !== true)
                issues.push({ severity: "info", path: `${p}.securityContext.allowPrivilegeEscalation`, message: `${label}: set allowPrivilegeEscalation: false.` });
        }
        arr(c.env).filter(isObj).forEach((e, i) => {
            const n = str(e.name);
            const v = typeof e.value === "string" ? e.value : "";
            if (!v || /^\$\(|^\$\{/.test(v)) return;
            if (SECRET_NAME.test(n) || SECRET_VALUE.test(v))
                issues.push({ severity: "warning", path: `${p}.env[${i}]`, message: `${label}: env ${n} has a plain-text value that looks like a secret. Use valueFrom.secretKeyRef instead.` });
        });
    }
    return info;
}

// --- per-kind ----------------------------------------------------------------------------------------

interface Parsed {
    doc: Obj;
    res: DocResult;
}

interface Workload {
    kind: string;
    name: string;
    namespace: string;
    labels: Obj;
    ports: PodInfo["ports"];
}

const WORKLOADS = ["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Pod", "Job"];

function podTemplateSpec(kind: string, spec: Obj | undefined): { podSpec?: Obj; labels?: Obj; path: string } {
    if (kind === "Pod") return { podSpec: spec, labels: undefined, path: "spec" };
    if (kind === "CronJob") {
        const t = obj(obj(obj(spec?.jobTemplate)?.spec)?.template);
        return { podSpec: obj(t?.spec), labels: obj(obj(t?.metadata)?.labels), path: "spec.jobTemplate.spec.template.spec" };
    }
    const t = obj(spec?.template);
    return { podSpec: obj(t?.spec), labels: obj(obj(t?.metadata)?.labels), path: "spec.template.spec" };
}

function imagesText(info: PodInfo) {
    return info.images.length ? info.images.join(", ") : "no image";
}
function portsText(info: PodInfo) {
    if (!info.ports.length) return "";
    return ` on port${info.ports.length > 1 ? "s" : ""} ${info.ports.map((p) => p.port + (p.protocol !== "TCP" ? `/${p.protocol}` : "")).join(", ")}`;
}

function analyzeWorkload(kind: string, doc: Obj, res: DocResult, workloads: Workload[]) {
    const spec = obj(doc.spec);
    const { issues, summary } = res;
    if (!spec) {
        issues.push({ severity: "error", path: "spec", message: "spec is missing." });
        return;
    }
    const { podSpec, labels, path } = podTemplateSpec(kind, spec);
    const info = checkPodSpec(podSpec, path, kind, issues);

    if (kind === "Pod") {
        workloads.push({ kind, name: res.name, namespace: res.namespace, labels: obj(obj(doc.metadata)?.labels) ?? {}, ports: info.ports });
        summary.push(`Pod ${res.name} runs ${imagesText(info)}${portsText(info)}.`);
        issues.push({ severity: "info", message: "A bare Pod is not rescheduled if its node dies; prefer a Deployment, StatefulSet or Job." });
        return;
    }

    // selector
    const sel = obj(spec.selector);
    const matchLabels = obj(sel?.matchLabels);
    if (kind !== "Job") {
        if (!sel) issues.push({ severity: "error", path: "spec.selector", message: "spec.selector is required in apps/v1." });
        else if (!matchLabels && !arr(sel.matchExpressions).length) issues.push({ severity: "error", path: "spec.selector", message: "spec.selector needs matchLabels or matchExpressions." });
    }
    if (!obj(spec.template)) issues.push({ severity: "error", path: "spec.template", message: "spec.template is required." });
    else if (matchLabels) {
        const missing = Object.entries(matchLabels).filter(([k, v]) => str(labels?.[k]) !== str(v));
        if (missing.length)
            issues.push({ severity: "error", path: "spec.template.metadata.labels", message: `Template labels do not match the selector (${missing.map(([k, v]) => `${k}=${str(v)}`).join(", ")}); the API server rejects this.` });
    }

    if (WORKLOADS.includes(kind)) workloads.push({ kind, name: res.name, namespace: res.namespace, labels: labels ?? {}, ports: info.ports });

    const selText = labelsText(matchLabels);
    const replicas = spec.replicas === undefined ? 1 : Number(spec.replicas);
    if (kind === "Deployment" || kind === "ReplicaSet") {
        const strat = obj(spec.strategy);
        const type = str(strat?.type) || "RollingUpdate";
        let stratText = "";
        if (kind === "Deployment") {
            if (type === "Recreate") stratText = ", recreate strategy (all old pods stop before new ones start, so expect downtime)";
            else {
                const ru = obj(strat?.rollingUpdate);
                stratText = `, rolling update (maxSurge ${str(ru?.maxSurge) || "25%"}, maxUnavailable ${str(ru?.maxUnavailable) || "25%"})`;
            }
        }
        summary.push(`${kind} ${res.name} runs ${plural(replicas, "replica")} of ${imagesText(info)}${portsText(info)}${selText ? `, selects ${selText}` : ""}${stratText}.`);
        if (kind === "Deployment" && replicas === 1) issues.push({ severity: "info", path: "spec.replicas", message: "replicas: 1 (or unset) means downtime whenever the pod restarts or its node drains. Consider 2+ with a PodDisruptionBudget." });
    } else if (kind === "StatefulSet") {
        const vct = arr(spec.volumeClaimTemplates).filter(isObj);
        summary.push(`StatefulSet ${res.name} runs ${plural(replicas, "replica")} of ${imagesText(info)}${portsText(info)} with stable names ${res.name}-0…${res.name}-${Math.max(0, replicas - 1)}${selText ? `, selects ${selText}` : ""}.`);
        if (vct.length) summary.push(`Each replica gets its own volume: ${vct.map((v) => `${str(obj(v.metadata)?.name)} (${str(obj(obj(obj(v.spec)?.resources)?.requests)?.storage) || "?"})`).join(", ")}.`);
        if (!spec.serviceName) issues.push({ severity: "warning", path: "spec.serviceName", message: "StatefulSet has no serviceName; stable DNS names need a headless Service." });
    } else if (kind === "DaemonSet") {
        summary.push(`DaemonSet ${res.name} runs one pod of ${imagesText(info)} on every eligible node${portsText(info)}${selText ? `, selects ${selText}` : ""}.`);
    } else if (kind === "Job") {
        summary.push(`Job ${res.name} runs ${imagesText(info)} to completion${spec.completions ? ` ${plural(Number(spec.completions), "time")}` : " once"}${spec.parallelism ? `, ${spec.parallelism} at a time` : ""}, retrying up to ${str(spec.backoffLimit) || "6"} times.`);
        if (spec.ttlSecondsAfterFinished === undefined) issues.push({ severity: "info", path: "spec.ttlSecondsAfterFinished", message: "No ttlSecondsAfterFinished; finished Jobs and their pods stay around until deleted." });
    }
}

const CRON_MACROS: Record<string, string> = {
    "@yearly": "0 0 1 1 *",
    "@annually": "0 0 1 1 *",
    "@monthly": "0 0 1 * *",
    "@weekly": "0 0 * * 0",
    "@daily": "0 0 * * *",
    "@midnight": "0 0 * * *",
    "@hourly": "0 * * * *",
};

function analyzeCronJob(doc: Obj, res: DocResult) {
    const spec = obj(doc.spec);
    const { issues, summary } = res;
    if (!spec) {
        issues.push({ severity: "error", path: "spec", message: "spec is missing." });
        return;
    }
    const schedule = str(spec.schedule).trim();
    let when = "";
    if (!schedule) issues.push({ severity: "error", path: "spec.schedule", message: "spec.schedule is required." });
    else {
        let expr = schedule.replace(/^(CRON_)?TZ=\S+\s+/, "");
        if (expr !== schedule) issues.push({ severity: "warning", path: "spec.schedule", message: "TZ= inside schedule is not officially supported; use spec.timeZone." });
        expr = CRON_MACROS[expr.toLowerCase()] ?? expr;
        if (expr.split(/\s+/).length !== 5) issues.push({ severity: "error", path: "spec.schedule", message: `Schedule "${schedule}" must have 5 fields (minute hour day month weekday).` });
        else {
            try {
                when = cronToString(expr, { throwExceptionOnParseError: true, use24HourTimeFormat: true, verbose: false });
            } catch (e) {
                issues.push({ severity: "error", path: "spec.schedule", message: `Invalid schedule: ${typeof e === "string" ? e : (e as Error).message}` });
            }
        }
    }
    const jt = obj(spec.jobTemplate);
    if (!jt) issues.push({ severity: "error", path: "spec.jobTemplate", message: "spec.jobTemplate is required." });
    const { podSpec, path } = podTemplateSpec("CronJob", spec);
    const info = jt ? checkPodSpec(podSpec, path, "CronJob", issues) : { images: [] as string[] };
    const tz = str(spec.timeZone);
    summary.push(`CronJob ${res.name} runs ${imagesText(info as PodInfo)} ${when ? when.charAt(0).toLowerCase() + when.slice(1) : `on schedule ${schedule || "?"}`}${tz ? ` (${tz})` : " (controller time zone, usually UTC)"}.`);
    const cp = str(spec.concurrencyPolicy) || "Allow";
    const cpText: Record<string, string> = {
        Allow: "Allow (default): a new run starts even if the previous one is still running",
        Forbid: "Forbid: a run is skipped while the previous one is still running",
        Replace: "Replace: a still-running job is cancelled and replaced by the new run",
    };
    summary.push(`Concurrency policy ${cpText[cp] ?? cp}.`);
    if (!cpText[cp]) issues.push({ severity: "error", path: "spec.concurrencyPolicy", message: `concurrencyPolicy must be Allow, Forbid or Replace (found ${cp}).` });
    if (spec.suspend === true) summary.push("The CronJob is suspended; no new runs will start.");
    if (spec.startingDeadlineSeconds === undefined) issues.push({ severity: "info", path: "spec.startingDeadlineSeconds", message: "No startingDeadlineSeconds; after a long controller outage, missed runs may be counted and the job can stop scheduling (more than 100 misses)." });
    const s = spec.successfulJobsHistoryLimit ?? 3;
    const f = spec.failedJobsHistoryLimit ?? 1;
    summary.push(`Keeps the last ${str(s)} successful and ${str(f)} failed jobs.`);
}

function servicePorts(spec: Obj) {
    return arr(spec.ports).filter(isObj);
}

function analyzeService(doc: Obj, res: DocResult) {
    const spec = obj(doc.spec);
    const { issues, summary } = res;
    if (!spec) {
        issues.push({ severity: "error", path: "spec", message: "spec is missing." });
        return;
    }
    const type = str(spec.type) || "ClusterIP";
    if (type === "ExternalName") {
        if (!spec.externalName) issues.push({ severity: "error", path: "spec.externalName", message: "ExternalName Services need spec.externalName." });
        summary.push(`Service ${res.name} is a DNS alias (CNAME) for ${str(spec.externalName) || "?"}.`);
        return;
    }
    const ports = servicePorts(spec);
    if (!ports.length) issues.push({ severity: "error", path: "spec.ports", message: "spec.ports needs at least one port." });
    ports.forEach((p, i) => {
        const n = Number(p.port);
        if (!Number.isInteger(n) || n < 1 || n > 65535) issues.push({ severity: "error", path: `spec.ports[${i}].port`, message: `Port ${str(p.port) || "(missing)"} is not a valid port number.` });
        if (ports.length > 1 && !p.name) issues.push({ severity: "error", path: `spec.ports[${i}].name`, message: "Every port needs a name when a Service has more than one port." });
        if (type === "NodePort" || type === "LoadBalancer") {
            const np = p.nodePort;
            if (np !== undefined && (Number(np) < 30000 || Number(np) > 32767)) issues.push({ severity: "warning", path: `spec.ports[${i}].nodePort`, message: `nodePort ${str(np)} is outside the default range 30000-32767.` });
        }
    });
    const portList = ports.map((p) => `${str(p.port)}→${str(p.targetPort) || str(p.port)}${p.protocol && p.protocol !== "TCP" ? `/${str(p.protocol)}` : ""}${p.nodePort ? ` (node ${str(p.nodePort)})` : ""}`).join(", ");
    const headless = spec.clusterIP === "None";
    const typeText: Record<string, string> = {
        ClusterIP: headless ? "a headless Service (no virtual IP; DNS returns pod IPs)" : "a ClusterIP Service (reachable only inside the cluster)",
        NodePort: "a NodePort Service (reachable on every node's IP)",
        LoadBalancer: "a LoadBalancer Service (cloud load balancer with a public or internal IP)",
    };
    summary.push(`Service ${res.name} is ${typeText[type] ?? `a ${type} Service`} exposing ${portList || "no ports"}.`);
    const sel = obj(spec.selector);
    if (sel && Object.keys(sel).length) summary.push(`Sends traffic to pods labelled ${labelsText(sel)}.`);
    else {
        summary.push("No selector: endpoints must be managed manually (EndpointSlice).");
    }
}

/** Second pass: Service ↔ workload and Ingress ↔ Service cross references. */
function crossCheck(parsed: Parsed[], workloads: Workload[]) {
    const services = parsed.filter((p) => p.res.kind === "Service");
    for (const { doc, res } of services) {
        const spec = obj(doc.spec);
        const sel = obj(spec?.selector);
        if (!spec || !sel || !Object.keys(sel).length || str(spec.type) === "ExternalName") continue;
        const matches = workloads.filter((w) => w.namespace === res.namespace && Object.entries(sel).every(([k, v]) => str(w.labels[k]) === str(v)));
        if (matches.length) {
            res.summary.push(`Matches ${matches.map((m) => `${m.kind} ${m.name}`).join(", ")} in this paste.`);
            servicePorts(spec).forEach((p, i) => {
                const tp = p.targetPort ?? p.port;
                if (typeof tp === "string" && !/^\d+$/.test(tp)) {
                    if (!matches.some((m) => m.ports.some((cp) => cp.name === tp)))
                        res.issues.push({ severity: "warning", path: `spec.ports[${i}].targetPort`, message: `targetPort ${tp} is a named port, but no matched container declares a port with that name.` });
                } else {
                    const n = Number(tp);
                    const declared = matches.flatMap((m) => m.ports);
                    if (declared.length && !declared.some((cp) => cp.port === n))
                        res.issues.push({ severity: "info", path: `spec.ports[${i}].targetPort`, message: `targetPort ${n} is not among the matched containers' declared ports (${[...new Set(declared.map((d) => d.port))].join(", ")}).` });
                }
            });
        } else {
            const any = workloads.some((w) => w.namespace === res.namespace);
            res.issues.push({
                severity: any ? "warning" : "info",
                path: "spec.selector",
                message: any
                    ? `Selector ${labelsText(sel)} matches no workload in this paste; the Service will have no endpoints unless another manifest provides them.`
                    : `No workload in this paste to check the selector ${labelsText(sel)} against.`,
            });
        }
    }

    for (const { doc, res } of parsed.filter((p) => p.res.kind === "Ingress")) {
        for (const ref of ingressBackends(doc)) {
            if (!ref.service) continue;
            const svc = services.find((s) => s.res.name === ref.service && s.res.namespace === res.namespace);
            if (!svc) {
                res.issues.push({ severity: "info", path: ref.path, message: `Backend Service ${ref.service} is not in this paste.` });
                continue;
            }
            const ports = servicePorts(obj(svc.doc.spec) ?? {});
            if (ref.port && !ports.some((p) => str(p.port) === ref.port || str(p.name) === ref.port))
                res.issues.push({ severity: "warning", path: ref.path, message: `Service ${ref.service} has no port ${ref.port} (it exposes ${ports.map((p) => str(p.name) || str(p.port)).join(", ") || "nothing"}).` });
        }
    }

    for (const { doc, res } of parsed.filter((p) => p.res.kind === "HorizontalPodAutoscaler")) {
        const ref = obj(obj(doc.spec)?.scaleTargetRef);
        if (!ref) continue;
        const target = parsed.find((p) => p.res.kind === str(ref.kind) && p.res.name === str(ref.name) && p.res.namespace === res.namespace);
        if (!target) res.issues.push({ severity: "info", path: "spec.scaleTargetRef", message: `Target ${str(ref.kind)} ${str(ref.name)} is not in this paste.` });
        else if (obj(target.doc.spec)?.replicas !== undefined)
            target.res.issues.push({ severity: "info", path: "spec.replicas", message: `HorizontalPodAutoscaler ${res.name} manages replicas; leaving spec.replicas set makes every kubectl apply reset the scale.` });
    }
}

interface BackendRef { service: string; port: string; path: string; text: string }

function backendOf(b: Obj | undefined, path: string): BackendRef | null {
    if (!b) return null;
    const svc = obj(b.service);
    if (svc) {
        const port = obj(svc.port);
        const p = str(port?.number) || str(port?.name);
        return { service: str(svc.name), port: p, path, text: `${str(svc.name) || "?"}:${p || "?"}` };
    }
    if (b.serviceName !== undefined) return { service: str(b.serviceName), port: str(b.servicePort), path, text: `${str(b.serviceName)}:${str(b.servicePort)}` };
    const res = obj(b.resource);
    if (res) return { service: "", port: "", path, text: `${str(res.kind)} ${str(res.name)}` };
    return { service: "", port: "", path, text: "?" };
}

function ingressBackends(doc: Obj): BackendRef[] {
    const spec = obj(doc.spec);
    const out: BackendRef[] = [];
    const def = backendOf(obj(spec?.defaultBackend) ?? obj(spec?.backend), "spec.defaultBackend");
    if (def) out.push(def);
    arr(spec?.rules).filter(isObj).forEach((r, i) =>
        arr(obj(r.http)?.paths).filter(isObj).forEach((p, j) => {
            const b = backendOf(obj(p.backend), `spec.rules[${i}].http.paths[${j}].backend`);
            if (b) out.push(b);
        }),
    );
    return out;
}

function analyzeIngress(doc: Obj, res: DocResult) {
    const spec = obj(doc.spec);
    const { issues, summary } = res;
    if (!spec) {
        issues.push({ severity: "error", path: "spec", message: "spec is missing." });
        return;
    }
    const v1 = res.apiVersion === "networking.k8s.io/v1";
    const rules = arr(spec.rules).filter(isObj);
    const def = obj(spec.defaultBackend) ?? obj(spec.backend);
    if (!rules.length && !def) issues.push({ severity: "error", path: "spec.rules", message: "An Ingress needs spec.rules or spec.defaultBackend." });
    const cls = str(spec.ingressClassName) || str(obj(obj(doc.metadata)?.annotations)?.["kubernetes.io/ingress.class"]);
    summary.push(`Ingress ${res.name}${cls ? ` (class ${cls})` : ""} routes:`);
    if (!cls) issues.push({ severity: "info", path: "spec.ingressClassName", message: "No ingressClassName; the cluster default IngressClass is used, if there is one." });
    rules.forEach((r, i) => {
        const host = str(r.host) || "*";
        const paths = arr(obj(r.http)?.paths).filter(isObj);
        if (!paths.length) issues.push({ severity: "error", path: `spec.rules[${i}].http.paths`, message: `Rule for host ${host} has no http.paths.` });
        paths.forEach((p, j) => {
            const base = `spec.rules[${i}].http.paths[${j}]`;
            const b = obj(p.backend);
            const ref = backendOf(b, `${base}.backend`);
            if (!b) issues.push({ severity: "error", path: `${base}.backend`, message: "Path has no backend." });
            else if (v1) {
                const svc = obj(b.service);
                if (b.serviceName !== undefined) issues.push({ severity: "error", path: `${base}.backend`, message: "serviceName/servicePort are the old v1beta1 fields; networking.k8s.io/v1 uses backend.service.name and backend.service.port.number." });
                else if (svc) {
                    if (!svc.name) issues.push({ severity: "error", path: `${base}.backend.service.name`, message: "Backend service name is required." });
                    const port = obj(svc.port);
                    if (!port || (port.number === undefined && port.name === undefined)) issues.push({ severity: "error", path: `${base}.backend.service.port`, message: "Backend service port (number or name) is required." });
                } else if (!b.resource) issues.push({ severity: "error", path: `${base}.backend`, message: "Backend needs service or resource." });
            } else if (!b.serviceName || b.servicePort === undefined) issues.push({ severity: "error", path: `${base}.backend`, message: "Backend needs serviceName and servicePort." });
            if (v1 && !p.pathType) issues.push({ severity: "error", path: `${base}.pathType`, message: "pathType (Prefix, Exact or ImplementationSpecific) is required in networking.k8s.io/v1." });
            summary.push(`• ${host}${str(p.path) || "/"}${p.pathType ? ` (${str(p.pathType)})` : ""} → ${ref?.text ?? "?"}`);
        });
    });
    const d = backendOf(def, "spec.defaultBackend");
    if (d) summary.push(`• everything else → ${d.text}`);
    const tls = arr(spec.tls).filter(isObj);
    if (tls.length) {
        tls.forEach((t) => summary.push(`TLS for ${arr(t.hosts).map(str).join(", ") || "all hosts"} using Secret ${str(t.secretName) || "(default certificate)"}.`));
        const tlsHosts = new Set(tls.flatMap((t) => arr(t.hosts).map(str)));
        const plain = rules.map((r) => str(r.host)).filter((h) => h && !tlsHosts.has(h));
        if (plain.length) issues.push({ severity: "info", path: "spec.tls", message: `Host${plain.length > 1 ? "s" : ""} ${plain.join(", ")} not covered by TLS.` });
    } else {
        summary.push("No TLS: traffic is plain HTTP.");
        issues.push({ severity: "info", path: "spec.tls", message: "No TLS section; add one (e.g. with cert-manager) to serve HTTPS." });
    }
}

function b64Length(v: string): number | null {
    const s = v.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 === 1) return null;
    try {
        return atob(s.padEnd(Math.ceil(s.length / 4) * 4, "=")).length;
    } catch {
        return null;
    }
}

function analyzeConfig(kind: string, doc: Obj, res: DocResult) {
    const { issues, summary } = res;
    if (kind === "ConfigMap") {
        const data = obj(doc.data) ?? {};
        const bin = obj(doc.binaryData) ?? {};
        const keys = Object.keys(data);
        summary.push(`ConfigMap ${res.name} holds ${plural(keys.length, "key")}${keys.length ? `: ${keys.join(", ")}` : ""}${Object.keys(bin).length ? ` plus ${plural(Object.keys(bin).length, "binary key")}` : ""}.`);
        if (!keys.length && !Object.keys(bin).length) issues.push({ severity: "info", path: "data", message: "ConfigMap has no data." });
        for (const [k, v] of Object.entries(data)) {
            if (typeof v !== "string") issues.push({ severity: "error", path: `data.${k}`, message: `Value of ${k} must be a string (quote numbers and booleans).` });
            if ((SECRET_NAME.test(k) || SECRET_VALUE.test(str(v))) && str(v)) issues.push({ severity: "warning", path: `data.${k}`, message: `${k} looks like a secret; ConfigMaps are not meant for credentials. Use a Secret.` });
        }
        if (doc.immutable === true) summary.push("Immutable: changes require a new ConfigMap.");
        return;
    }
    // Secret
    const type = str(doc.type) || "Opaque";
    const data = obj(doc.data) ?? {};
    const sd = obj(doc.stringData) ?? {};
    summary.push(`Secret ${res.name} (type ${type}) holds ${plural(Object.keys(data).length + Object.keys(sd).length, "key")}.`);
    for (const [k, v] of Object.entries(data)) {
        const n = b64Length(str(v));
        if (n === null) {
            issues.push({ severity: "error", path: `data.${k}`, message: `data.${k} is not valid base64. Put plain text under stringData instead.` });
            summary.push(`• ${k}: invalid base64`);
        } else summary.push(`• ${k} (data): ${plural(n, "byte")} when decoded`);
    }
    for (const [k, v] of Object.entries(sd)) summary.push(`• ${k} (stringData): ${plural(str(v).length, "character")}, plain text`);
    if (Object.keys(data).length) issues.push({ severity: "info", path: "data", message: "data values are only base64-encoded, not encrypted. Anyone with the manifest can decode them; keep it out of Git (Sealed Secrets, SOPS, External Secrets)." });
    if (Object.keys(sd).length) issues.push({ severity: "warning", path: "stringData", message: "stringData holds plain-text values in this manifest; never commit it. The API server merges it into data on write." });
    if (type === "kubernetes.io/tls" && (!("tls.crt" in data || "tls.crt" in sd) || !("tls.key" in data || "tls.key" in sd)))
        issues.push({ severity: "error", path: "data", message: "kubernetes.io/tls Secrets need tls.crt and tls.key." });
    if (type === "kubernetes.io/dockerconfigjson" && !(".dockerconfigjson" in data || ".dockerconfigjson" in sd))
        issues.push({ severity: "error", path: "data", message: "kubernetes.io/dockerconfigjson Secrets need a .dockerconfigjson key." });
}

function analyzeOther(kind: string, doc: Obj, res: DocResult) {
    const spec = obj(doc.spec);
    const { issues, summary } = res;
    switch (kind) {
        case "PersistentVolumeClaim": {
            const modes = arr(spec?.accessModes).map(str);
            const size = str(obj(obj(spec?.resources)?.requests)?.storage);
            if (!modes.length) issues.push({ severity: "error", path: "spec.accessModes", message: "spec.accessModes is required." });
            if (!size) issues.push({ severity: "error", path: "spec.resources.requests.storage", message: "spec.resources.requests.storage is required." });
            summary.push(`PersistentVolumeClaim ${res.name} requests ${size || "?"} (${modes.join(", ") || "no access mode"}) from storage class ${spec?.storageClassName === undefined ? "default" : str(spec.storageClassName) || "(none, static binding)"}.`);
            break;
        }
        case "HorizontalPodAutoscaler": {
            const ref = obj(spec?.scaleTargetRef);
            if (!ref?.name || !ref.kind) issues.push({ severity: "error", path: "spec.scaleTargetRef", message: "spec.scaleTargetRef needs kind and name." });
            if (spec?.maxReplicas === undefined) issues.push({ severity: "error", path: "spec.maxReplicas", message: "spec.maxReplicas is required." });
            const min = spec?.minReplicas ?? 1;
            const metrics = arr(spec?.metrics).filter(isObj).map((m) => {
                const r = obj(m.resource) ?? obj(m.containerResource);
                const t = obj(r?.target);
                if (r) return `${str(r.name)} ${t?.averageUtilization !== undefined ? `at ${str(t.averageUtilization)}% utilisation` : `at ${str(t?.averageValue) || str(t?.value)}`}`;
                return `${str(m.type)} metric`;
            });
            if (spec?.targetCPUUtilizationPercentage !== undefined) metrics.push(`cpu at ${str(spec.targetCPUUtilizationPercentage)}% utilisation`);
            summary.push(`HorizontalPodAutoscaler ${res.name} scales ${str(ref?.kind)} ${str(ref?.name)} between ${str(min)} and ${str(spec?.maxReplicas) || "?"} replicas${metrics.length ? `, targeting ${metrics.join(" and ")}` : " (default: 80% CPU)"}.`);
            if (Number(min) > Number(spec?.maxReplicas)) issues.push({ severity: "error", path: "spec.minReplicas", message: "minReplicas is greater than maxReplicas." });
            break;
        }
        case "Namespace":
            summary.push(`Namespace ${res.name}${labelsText(obj(obj(doc.metadata)?.labels)) ? ` with labels ${labelsText(obj(obj(doc.metadata)?.labels))}` : ""}.`);
            break;
        case "ServiceAccount": {
            summary.push(`ServiceAccount ${res.name} is an identity for pods in namespace ${res.namespace}.`);
            if (doc.automountServiceAccountToken !== false) issues.push({ severity: "info", path: "automountServiceAccountToken", message: "Its API token is mounted into every pod that uses it; set automountServiceAccountToken: false if the app does not call the Kubernetes API." });
            if (arr(doc.imagePullSecrets).length) summary.push(`Pulls images with ${arr(doc.imagePullSecrets).map((s) => str(obj(s)?.name)).join(", ")}.`);
            break;
        }
        case "PodDisruptionBudget":
            summary.push(`PodDisruptionBudget ${res.name} keeps ${spec?.minAvailable !== undefined ? `at least ${str(spec.minAvailable)} available` : `at most ${str(spec?.maxUnavailable)} unavailable`} of pods labelled ${labelsText(obj(obj(spec?.selector)?.matchLabels)) || "?"} during voluntary disruptions.`);
            break;
        default:
            summary.push(`${kind || "Resource"}${res.name ? ` ${res.name}` : ""}${res.apiVersion ? ` (${res.apiVersion})` : ""}. No detailed checks for this kind.`);
    }
}

// --- driver ------------------------------------------------------------------------------------------

const NAME_RE = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/;

export function analyze(text: string): DocResult[] {
    const lines = text.split(/\r?\n/);
    const chunks: { start: number; body: string }[] = [];
    let start = 0;
    let buf: string[] = [];
    lines.forEach((l, i) => {
        if (/^---(\s|$)/.test(l)) {
            chunks.push({ start, body: buf.join("\n") });
            buf = [l.replace(/^---\s?/, "").replace(/^\s*#.*$/, "")];
            start = i;
        } else if (/^\.\.\.\s*$/.test(l)) buf.push("");
        else buf.push(l);
    });
    chunks.push({ start, body: buf.join("\n") });

    const out: DocResult[] = [];
    const parsed: Parsed[] = [];
    const workloads: Workload[] = [];
    let index = 0;
    for (const ch of chunks) {
        if (!ch.body.split("\n").some((l) => l.trim() && !l.trim().startsWith("#"))) continue;
        index++;
        const firstLine = ch.start + 1 + ch.body.split("\n").findIndex((l) => l.trim() && !l.trim().startsWith("#"));
        const blank = (): DocResult => ({ index, line: firstLine, kind: "", apiVersion: "", name: "", namespace: "default", summary: [], issues: [] });
        let doc: unknown;
        try {
            doc = load(ch.body);
        } catch (e) {
            const err = e as { reason?: string; message?: string; mark?: { line: number; column: number } };
            const r = blank();
            r.parseError = err.mark ? `YAML error at line ${ch.start + err.mark.line + 1}, column ${err.mark.column + 1}: ${err.reason ?? err.message}` : `YAML error: ${err.message}`;
            out.push(r);
            continue;
        }
        const items: Obj[] = [];
        if (!isObj(doc)) {
            const r = blank();
            r.issues.push({ severity: "error", message: "Document is not a mapping (expected apiVersion, kind, metadata…)." });
            out.push(r);
            continue;
        }
        if (str(doc.kind).endsWith("List") && Array.isArray(doc.items)) items.push(...doc.items.filter(isObj));
        else items.push(doc);
        for (const d of items) {
            const meta = obj(d.metadata);
            const r: DocResult = {
                ...blank(),
                kind: str(d.kind),
                apiVersion: str(d.apiVersion),
                name: str(meta?.name) || (meta?.generateName ? `${str(meta.generateName)}*` : ""),
                namespace: str(meta?.namespace) || "default",
            };
            if (!r.apiVersion) r.issues.push({ severity: "error", path: "apiVersion", message: "apiVersion is required." });
            if (!r.kind) r.issues.push({ severity: "error", path: "kind", message: "kind is required." });
            if (!meta) r.issues.push({ severity: "error", path: "metadata", message: "metadata is required." });
            else if (!meta.name && !meta.generateName) r.issues.push({ severity: "error", path: "metadata.name", message: "metadata.name is required." });
            else if (meta.name && (!NAME_RE.test(str(meta.name)) || str(meta.name).length > 253))
                r.issues.push({ severity: "error", path: "metadata.name", message: `Name ${str(meta.name)} is invalid: use lowercase letters, digits, - and . (start and end alphanumeric).` });
            checkApiVersion(r.kind, r.apiVersion, r.issues);
            if (WORKLOADS.includes(r.kind)) analyzeWorkload(r.kind, d, r, workloads);
            else if (r.kind === "CronJob") analyzeCronJob(d, r);
            else if (r.kind === "Service") analyzeService(d, r);
            else if (r.kind === "Ingress") analyzeIngress(d, r);
            else if (r.kind === "ConfigMap" || r.kind === "Secret") analyzeConfig(r.kind, d, r);
            else analyzeOther(r.kind, d, r);
            parsed.push({ doc: d, res: r });
            out.push(r);
        }
    }

    const seen = new Map<string, DocResult>();
    for (const { res } of parsed) {
        if (!res.kind || !res.name) continue;
        const key = `${res.kind}/${res.namespace}/${res.name}`;
        const prev = seen.get(key);
        if (prev) res.issues.push({ severity: "warning", path: "metadata.name", message: `Duplicate ${res.kind} ${res.name} (also document ${prev.index}); the later one wins on apply.` });
        else seen.set(key, res);
    }
    crossCheck(parsed, workloads);
    const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
    for (const r of out) r.issues.sort((a, b) => order[a.severity] - order[b.severity]);
    return out;
}

export const K8S_SAMPLE = `# Demo stack with a few deliberate issues
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: shop
  labels:
    app: web
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: web
        tier: frontend
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 101
      containers:
        - name: nginx
          image: nginx:1.27
          ports:
            - name: http
              containerPort: 80
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits: { memory: 256Mi }
          readinessProbe:
            httpGet: { path: /healthz, port: http }
          livenessProbe:
            httpGet: { path: /healthz, port: http }
          securityContext:
            allowPrivilegeEscalation: false
        - name: api
          image: ghcr.io/acme/shop-api:latest
          env:
            - name: SPRING_PROFILES_ACTIVE
              value: prod
            - name: DB_PASSWORD
              value: hunter2
          ports:
            - containerPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: web
  namespace: shop
spec:
  type: ClusterIP
  selector:
    app: web
  ports:
    - name: http
      port: 80
      targetPort: http
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop
  namespace: shop
spec:
  ingressClassName: nginx
  tls:
    - hosts: [shop.example.com]
      secretName: shop-tls
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: web, port: { number: 80 } }
          - path: /admin
            pathType: Prefix
            backend:
              service: { name: admin, port: { number: 8081 } }
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: web-config
  namespace: shop
data:
  LOG_LEVEL: info
  FEATURE_FLAGS: "checkout-v2,dark-mode"
---
apiVersion: batch/v1beta1
kind: CronJob
metadata:
  name: nightly-report
  namespace: shop
spec:
  schedule: "30 2 * * 1-5"
  concurrencyPolicy: Forbid
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: report
              image: ghcr.io/acme/report-job
              args: ["--since", "24h"]
`;
