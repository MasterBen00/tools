<script setup lang="ts">
import { computed, reactive } from "vue";
import { useStorage } from "@vueuse/core";
import { ChevronDown, ChevronRight, ClipboardPaste, RotateCcw, Sparkles, Trash2 } from "lucide-vue-next";
import { Btn, CodeArea, CopyButton, Notice, Panel, ToolPage } from "@/components/ui";
import { useHandoff } from "@/composables/handoff";
import { readClipboard } from "@/composables/useClipboard";
import { DEFAULT_PREFIXES, causeChain, guessPackage, isFrameworkFrame, isProxyFrame, parseStackTrace, type Frame, type Throwable } from "./stackTrace";

const SAMPLE = `2026-11-22T10:41:07.512+01:00 ERROR 48213 --- [shop-service] [nio-8080-exec-7] o.a.c.c.C.[.[.[/].[dispatcherServlet]    : Servlet.service() for servlet [dispatcherServlet] in context with path [] threw exception
org.springframework.dao.DataIntegrityViolationException: could not execute statement [ERROR: duplicate key value violates unique constraint "uk_customer_email"
  Detail: Key (email)=(ada@example.com) already exists.] [insert into customer (created_at,email,name,id) values (?,?,?,?)]; SQL [insert into customer (created_at,email,name,id) values (?,?,?,?)]; constraint [uk_customer_email]
	at org.springframework.orm.jpa.vendor.HibernateJpaDialect.convertHibernateAccessException(HibernateJpaDialect.java:290) ~[spring-orm-6.2.1.jar:6.2.1]
	at org.springframework.orm.jpa.vendor.HibernateJpaDialect.translateExceptionIfPossible(HibernateJpaDialect.java:241) ~[spring-orm-6.2.1.jar:6.2.1]
	at org.springframework.orm.jpa.AbstractEntityManagerFactoryBean.translateExceptionIfPossible(AbstractEntityManagerFactoryBean.java:560) ~[spring-orm-6.2.1.jar:6.2.1]
	at org.springframework.dao.support.ChainedPersistenceExceptionTranslator.translateExceptionIfPossible(ChainedPersistenceExceptionTranslator.java:61) ~[spring-tx-6.2.1.jar:6.2.1]
	at org.springframework.dao.support.DataAccessUtils.translateIfNecessary(DataAccessUtils.java:343) ~[spring-tx-6.2.1.jar:6.2.1]
	at org.springframework.dao.support.PersistenceExceptionTranslationInterceptor.invoke(PersistenceExceptionTranslationInterceptor.java:160) ~[spring-tx-6.2.1.jar:6.2.1]
	at org.springframework.aop.framework.ReflectiveMethodInvocation.proceed(ReflectiveMethodInvocation.java:184) ~[spring-aop-6.2.1.jar:6.2.1]
	at org.springframework.aop.framework.JdkDynamicAopProxy.invoke(JdkDynamicAopProxy.java:223) ~[spring-aop-6.2.1.jar:6.2.1]
	at jdk.proxy2/jdk.proxy2.$Proxy142.save(Unknown Source) ~[na:na]
	at com.example.shop.customer.CustomerService.register(CustomerService.java:58) ~[classes/:na]
	at com.example.shop.customer.CustomerService$$SpringCGLIB$$0.register(<generated>) ~[classes/:na]
	at com.example.shop.customer.CustomerController.register(CustomerController.java:41) ~[classes/:na]
	at java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103) ~[na:na]
	at java.base/java.lang.reflect.Method.invoke(Method.java:580) ~[na:na]
	at org.springframework.web.method.support.InvocableHandlerMethod.doInvoke(InvocableHandlerMethod.java:257) ~[spring-web-6.2.1.jar:6.2.1]
	at org.springframework.web.method.support.InvocableHandlerMethod.invokeForRequest(InvocableHandlerMethod.java:190) ~[spring-web-6.2.1.jar:6.2.1]
	at org.springframework.web.servlet.mvc.method.annotation.ServletInvocableHandlerMethod.invokeAndHandle(ServletInvocableHandlerMethod.java:118) ~[spring-webmvc-6.2.1.jar:6.2.1]
	at org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerAdapter.invokeHandlerMethod(RequestMappingHandlerAdapter.java:986) ~[spring-webmvc-6.2.1.jar:6.2.1]
	at org.springframework.web.servlet.DispatcherServlet.doDispatch(DispatcherServlet.java:1089) ~[spring-webmvc-6.2.1.jar:6.2.1]
	at org.springframework.web.servlet.DispatcherServlet.doService(DispatcherServlet.java:979) ~[spring-webmvc-6.2.1.jar:6.2.1]
	at org.springframework.web.servlet.FrameworkServlet.processRequest(FrameworkServlet.java:1014) ~[spring-webmvc-6.2.1.jar:6.2.1]
	at org.springframework.web.servlet.FrameworkServlet.doPost(FrameworkServlet.java:914) ~[spring-webmvc-6.2.1.jar:6.2.1]
	at jakarta.servlet.http.HttpServlet.service(HttpServlet.java:590) ~[tomcat-embed-core-10.1.34.jar:6.0]
	at org.apache.catalina.core.ApplicationFilterChain.internalDoFilter(ApplicationFilterChain.java:195) ~[tomcat-embed-core-10.1.34.jar:10.1.34]
	at org.apache.catalina.core.ApplicationFilterChain.doFilter(ApplicationFilterChain.java:140) ~[tomcat-embed-core-10.1.34.jar:10.1.34]
	at com.example.shop.web.RequestIdFilter.doFilterInternal(RequestIdFilter.java:29) ~[classes/:na]
	at org.springframework.web.filter.OncePerRequestFilter.doFilter(OncePerRequestFilter.java:116) ~[spring-web-6.2.1.jar:6.2.1]
	at org.apache.catalina.core.StandardWrapperValve.invoke(StandardWrapperValve.java:167) ~[tomcat-embed-core-10.1.34.jar:10.1.34]
	at org.apache.coyote.http11.Http11Processor.service(Http11Processor.java:397) ~[tomcat-embed-core-10.1.34.jar:10.1.34]
	at org.apache.tomcat.util.net.NioEndpoint$SocketProcessor.doRun(NioEndpoint.java:1769) ~[tomcat-embed-core-10.1.34.jar:10.1.34]
	at org.apache.tomcat.util.threads.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1189) ~[tomcat-embed-core-10.1.34.jar:10.1.34]
	at java.base/java.lang.Thread.run(Thread.java:1583) ~[na:na]
Caused by: org.hibernate.exception.ConstraintViolationException: could not execute statement [ERROR: duplicate key value violates unique constraint "uk_customer_email"
  Detail: Key (email)=(ada@example.com) already exists.] [insert into customer (created_at,email,name,id) values (?,?,?,?)]
	at org.hibernate.exception.internal.SQLStateConversionDelegate.convert(SQLStateConversionDelegate.java:97) ~[hibernate-core-6.6.4.Final.jar:6.6.4.Final]
	at org.hibernate.exception.internal.StandardSQLExceptionConverter.convert(StandardSQLExceptionConverter.java:58) ~[hibernate-core-6.6.4.Final.jar:6.6.4.Final]
	at org.hibernate.engine.jdbc.spi.SqlExceptionHelper.convert(SqlExceptionHelper.java:108) ~[hibernate-core-6.6.4.Final.jar:6.6.4.Final]
	at org.hibernate.engine.jdbc.internal.ResultSetReturnImpl.executeUpdate(ResultSetReturnImpl.java:194) ~[hibernate-core-6.6.4.Final.jar:6.6.4.Final]
	at org.hibernate.persister.entity.mutation.InsertCoordinatorStandard.doStaticInserts(InsertCoordinatorStandard.java:194) ~[hibernate-core-6.6.4.Final.jar:6.6.4.Final]
	at org.hibernate.internal.SessionImpl.flush(SessionImpl.java:1371) ~[hibernate-core-6.6.4.Final.jar:6.6.4.Final]
	at org.springframework.data.jpa.repository.support.SimpleJpaRepository.save(SimpleJpaRepository.java:629) ~[spring-data-jpa-3.4.1.jar:3.4.1]
	at java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103) ~[na:na]
	... 58 common frames omitted
Caused by: org.postgresql.util.PSQLException: ERROR: duplicate key value violates unique constraint "uk_customer_email"
  Detail: Key (email)=(ada@example.com) already exists.
	at org.postgresql.core.v3.QueryExecutorImpl.receiveErrorResponse(QueryExecutorImpl.java:2733) ~[postgresql-42.7.4.jar:42.7.4]
	at org.postgresql.core.v3.QueryExecutorImpl.processResults(QueryExecutorImpl.java:2420) ~[postgresql-42.7.4.jar:42.7.4]
	at org.postgresql.core.v3.QueryExecutorImpl.execute(QueryExecutorImpl.java:372) ~[postgresql-42.7.4.jar:42.7.4]
	at org.postgresql.jdbc.PgStatement.executeInternal(PgStatement.java:517) ~[postgresql-42.7.4.jar:42.7.4]
	at org.postgresql.jdbc.PgPreparedStatement.executeUpdate(PgPreparedStatement.java:152) ~[postgresql-42.7.4.jar:42.7.4]
	at com.zaxxer.hikari.pool.ProxyPreparedStatement.executeUpdate(ProxyPreparedStatement.java:61) ~[HikariCP-5.1.0.jar:na]
	at com.zaxxer.hikari.pool.HikariProxyPreparedStatement.executeUpdate(HikariProxyPreparedStatement.java) ~[HikariCP-5.1.0.jar:na]
	at org.hibernate.engine.jdbc.internal.ResultSetReturnImpl.executeUpdate(ResultSetReturnImpl.java:191) ~[hibernate-core-6.6.4.Final.jar:6.6.4.Final]
	... 66 common frames omitted
`;

const input = useStorage("devtools:stack-trace-beautifier:input", SAMPLE);
const userPkg = useStorage("devtools:stack-trace-beautifier:package", "com.example.shop");
const prefixText = useStorage("devtools:stack-trace-beautifier:prefixes", DEFAULT_PREFIXES.join("\n"));
const rootFirst = useStorage("devtools:stack-trace-beautifier:root-first", false);
const collapse = useStorage("devtools:stack-trace-beautifier:collapse", true);

const prefixes = computed(() =>
    prefixText.value
        .split(/[\s,]+/)
        .map((p) => p.trim())
        .filter(Boolean),
);
const pkg = computed(() => userPkg.value.trim().replace(/\.$/, ""));

const parsed = computed(() => (input.value.trim() ? parseStackTrace(input.value) : null));
const chain = computed(() => (parsed.value ? causeChain(parsed.value.root) : []));
const rootCause = computed(() => chain.value[chain.value.length - 1]);
const suggestedPkg = computed(() => (parsed.value && !pkg.value ? guessPackage(parsed.value.root, prefixes.value) : ""));

function isUser(f: Frame) {
    if (isProxyFrame(f)) return false;
    return pkg.value ? f.cls === pkg.value || f.cls.startsWith(pkg.value + ".") : !isFrameworkFrame(f, prefixes.value);
}
function isFramework(f: Frame) {
    return !isUser(f) && isFrameworkFrame(f, prefixes.value);
}

/** First frame of your code, searched from the root cause outwards. */
const culprit = computed<{ t: Throwable; i: number } | null>(() => {
    for (const t of [...chain.value].reverse()) {
        const i = t.frames.findIndex(isUser);
        if (i >= 0) return { t, i };
    }
    return null;
});

interface Card {
    t: Throwable;
    kind: "top" | "cause" | "suppressed";
    depth: number;
    causeNo: number;
}
const cards = computed<Card[]>(() => {
    const out: Card[] = [];
    const addChain = (top: Throwable, depth: number, suppressed: boolean) => {
        let list = causeChain(top);
        if (depth === 0 && rootFirst.value) list = [...list].reverse();
        list.forEach((t) => {
            const pos = causeChain(top).indexOf(t);
            out.push({ t, kind: suppressed && pos === 0 ? "suppressed" : pos === 0 ? "top" : "cause", depth, causeNo: pos });
            for (const s of t.suppressed) addChain(s, depth + 1, true);
        });
    };
    if (parsed.value) addChain(parsed.value.root, 0, false);
    return out;
});

type Row = { kind: "frame"; f: Frame; i: number } | { kind: "group"; frames: { f: Frame; i: number }[]; key: string; pkgs: string };
function rows(t: Throwable, cardIdx: number): Row[] {
    const out: Row[] = [];
    let group: { f: Frame; i: number }[] = [];
    const flush = () => {
        if (!group.length) return;
        if (group.length === 1) out.push({ kind: "frame", ...group[0]! });
        else {
            const counts = new Map<string, number>();
            for (const g of group) {
                const p = g.f.cls.split(".").slice(0, 2).join(".");
                counts.set(p, (counts.get(p) ?? 0) + 1);
            }
            const pkgs = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p).join(", ");
            out.push({ kind: "group", frames: group, key: `${cardIdx}:${group[0]!.i}`, pkgs });
        }
        group = [];
    };
    t.frames.forEach((f, i) => {
        if (collapse.value && isFramework(f)) group.push({ f, i });
        else {
            flush();
            out.push({ kind: "frame", f, i });
        }
    });
    flush();
    return out;
}
const expanded = reactive(new Set<string>());
function toggle(key: string) {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
}

function simpleName(cls: string) {
    return cls.slice(cls.lastIndexOf(".") + 1);
}
function pkgOf(cls: string) {
    const i = cls.lastIndexOf(".");
    return i > 0 ? cls.slice(0, i + 1) : "";
}

const cleaned = computed(() => {
    if (!parsed.value) return "";
    const lines: string[] = [];
    const emit = (t: Throwable, label: string, indent: string) => {
        lines.push(`${indent}${label}${t.cls}${t.message ? ": " + t.message : ""}`);
        let skipped: Frame[] = [];
        const flush = () => {
            if (skipped.length === 1) lines.push(`${indent}\tat ${skipped[0]!.raw}`);
            else if (skipped.length) lines.push(`${indent}\t... ${skipped.length} framework frames`);
            skipped = [];
        };
        for (const f of t.frames) {
            if (isFramework(f)) skipped.push(f);
            else {
                flush();
                lines.push(`${indent}\tat ${f.raw.replace(/\s*~?\[[^\]]*\]$/, "")}`);
            }
        }
        flush();
        if (t.more) lines.push(`${indent}\t... ${t.more} more`);
        for (const s of t.suppressed) emit(s, "Suppressed: ", indent + "\t");
        if (t.cause) emit(t.cause, "Caused by: ", indent);
    };
    emit(parsed.value.root, "", "");
    return lines.join("\n") + "\n";
});

const stats = computed(() => {
    let frames = 0;
    let user = 0;
    for (const c of cards.value) {
        frames += c.t.frames.length;
        user += c.t.frames.filter(isUser).length;
    }
    return { frames, user };
});

async function paste() {
    input.value = await readClipboard();
}

// Input sent from the chat assistant.
useHandoff<{ input?: string }>("stack-trace-beautifier", (p) => {
    if (p.input != null) input.value = p.input;
});
</script>

<template>
    <ToolPage>
        <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Panel title="Stack trace" flush>
                <template #actions>
                    <Btn size="sm" variant="ghost" @click="input = SAMPLE"><Sparkles /> Sample</Btn>
                    <Btn size="sm" variant="ghost" @click="paste"><ClipboardPaste /> Paste</Btn>
                    <Btn size="sm" variant="ghost" :disabled="!input" @click="input = ''"><Trash2 /> Clear</Btn>
                </template>
                <CodeArea v-model="input" :wrap="false" height="14rem" placeholder="Paste a Java stack trace, or a log excerpt that contains one…" />
            </Panel>
            <Panel title="Options">
                <div class="flex flex-col gap-3 text-sm">
                    <div>
                        <label class="label" for="stb-pkg">Your package</label>
                        <input id="stb-pkg" v-model="userPkg" class="input font-mono" placeholder="com.acme" spellcheck="false" />
                        <button v-if="suggestedPkg" type="button" class="chip mt-1.5 cursor-pointer hover:text-fg" @click="userPkg = suggestedPkg">Use {{ suggestedPkg }}</button>
                    </div>
                    <label class="flex items-center gap-2"><input v-model="rootFirst" type="checkbox" class="checkbox" /> Show root cause first</label>
                    <label class="flex items-center gap-2"><input v-model="collapse" type="checkbox" class="checkbox" /> Collapse framework frames</label>
                    <details>
                        <summary class="cursor-pointer text-fg-muted">Framework prefixes ({{ prefixes.length }})</summary>
                        <textarea v-model="prefixText" class="input mt-2 h-40 resize-y font-mono text-xs" spellcheck="false" aria-label="Framework package prefixes" />
                        <div class="mt-1 flex items-center justify-between gap-2">
                            <span class="text-xs text-muted">One per line. CGLIB ($$) and JDK proxy frames always count as framework.</span>
                            <Btn size="sm" variant="ghost" @click="prefixText = DEFAULT_PREFIXES.join('\n')"><RotateCcw /> Reset</Btn>
                        </div>
                    </details>
                </div>
            </Panel>
        </div>

        <Notice v-if="input.trim() && !parsed" type="warning">No stack frames found. A Java stack trace has lines starting with <span class="code">at</span>.</Notice>

        <template v-if="parsed">
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span class="text-fg-muted">
                    {{ chain.length }} exception{{ chain.length === 1 ? "" : "s" }} in the chain · {{ stats.frames }} frames · {{ stats.user }} in your code
                </span>
                <span class="ml-auto"><CopyButton :text="cleaned" label="Copy cleaned trace" variant="secondary" /></span>
            </div>

            <Notice v-if="culprit" type="info">
                Likely culprit:
                <span class="font-mono font-medium break-all">{{ culprit.t.frames[culprit.i]!.cls }}.{{ culprit.t.frames[culprit.i]!.method }}({{ culprit.t.frames[culprit.i]!.location }})</span>
                <template v-if="rootCause && rootCause !== chain[0]"> while handling <span class="font-mono">{{ simpleName(rootCause.cls) }}</span></template>
            </Notice>

            <div class="flex flex-col gap-4">
                <section
                    v-for="(c, ci) in cards"
                    :key="ci"
                    class="min-w-0 overflow-hidden rounded-2xl border bg-surface shadow-card"
                    :class="[c.t === rootCause ? 'border-accent' : 'border-line', c.depth ? 'ml-4 sm:ml-8' : '']"
                >
                    <header class="flex flex-col gap-1.5 border-b border-line px-4 py-3" :class="c.t === rootCause ? 'bg-accent-soft' : ''">
                        <div class="flex flex-wrap items-center gap-2">
                            <span v-if="c.t === rootCause" class="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-fg">Root cause</span>
                            <span class="chip">{{ c.kind === "top" ? "Thrown" : c.kind === "suppressed" ? "Suppressed" : `Caused by #${c.causeNo}` }}</span>
                            <span class="font-mono text-sm break-all"><span class="text-fg-muted">{{ pkgOf(c.t.cls) }}</span><span class="font-semibold text-fg">{{ simpleName(c.t.cls) }}</span></span>
                        </div>
                        <p v-if="c.t.message" class="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-fg">{{ c.t.message }}</p>
                    </header>
                    <ol class="overflow-x-auto py-1.5 font-mono text-xs leading-relaxed">
                        <template v-for="r in rows(c.t, ci)" :key="r.kind === 'frame' ? `f${r.i}` : r.key">
                            <li
                                v-if="r.kind === 'frame'"
                                class="flex items-baseline gap-2 px-4 py-0.5 whitespace-nowrap"
                                :class="isUser(r.f) ? 'font-medium text-accent' : isFramework(r.f) ? 'text-fg-subtle' : 'text-fg'"
                            >
                                <span class="text-fg-subtle">at</span>
                                <span><span v-if="r.f.module" class="text-fg-subtle">{{ r.f.module }}/</span>{{ r.f.cls }}.<span class="font-semibold">{{ r.f.method }}</span>({{ r.f.location }})</span>
                                <span v-if="culprit && culprit.t === c.t && culprit.i === r.i" class="rounded-full bg-accent px-2 text-[10px] font-semibold text-accent-fg">likely culprit</span>
                            </li>
                            <template v-else>
                                <li>
                                    <button type="button" class="flex w-full cursor-pointer items-center gap-1.5 px-4 py-0.5 text-left text-fg-subtle hover:bg-subtle hover:text-fg" @click="toggle(r.key)">
                                        <ChevronDown v-if="expanded.has(r.key)" class="size-3.5" />
                                        <ChevronRight v-else class="size-3.5" />
                                        {{ r.frames.length }} framework frames <span class="truncate text-[11px]">({{ r.pkgs }})</span>
                                    </button>
                                </li>
                                <template v-if="expanded.has(r.key)">
                                    <li v-for="g in r.frames" :key="`g${g.i}`" class="px-4 py-0.5 pl-9 whitespace-nowrap text-fg-subtle">
                                        at <span v-if="g.f.module">{{ g.f.module }}/</span>{{ g.f.cls }}.{{ g.f.method }}({{ g.f.location }})
                                    </li>
                                </template>
                            </template>
                        </template>
                        <li v-if="c.t.more" class="px-4 py-0.5 text-fg-subtle italic">… {{ c.t.more }} more (same as the enclosing trace)</li>
                        <li v-if="!c.t.frames.length && !c.t.more" class="px-4 py-0.5 text-fg-subtle">No frames</li>
                    </ol>
                </section>
            </div>
        </template>

        <p class="text-xs text-muted">
            Reads printStackTrace, Logback and Log4j output, including log lines before the exception, <span class="code">Caused by:</span> chains, indented
            <span class="code">Suppressed:</span> blocks, module prefixes like <span class="code">java.base/</span> and <span class="code">~[jar]</span> suffixes. Nothing leaves your browser.
        </p>
    </ToolPage>
</template>
