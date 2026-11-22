<script setup lang="ts">
import { computed } from "vue";
import { useStorage } from "@vueuse/core";
import { ArrowLeftRight, ClipboardPaste, Sparkles, Trash2 } from "lucide-vue-next";
import { Btn, CodeArea, CopyButton, Notice, Panel, Tabs, ToolPage } from "@/components/ui";
import { useHandoff } from "@/composables/handoff";
import { readClipboard } from "@/composables/useClipboard";
import { propertiesToYaml, yamlToProperties } from "./springProps";

type Dir = "p2y" | "y2p";

const SAMPLE_PROPS = `# Shop service
spring.application.name=shop-service
server.port=8080
server.servlet.context-path: /api

# Database
spring.datasource.url=jdbc:postgresql://localhost:5432/shop
spring.datasource.username shop
spring.datasource.password=\${DB_PASSWORD:changeme}
spring.datasource.hikari.maximum-pool-size=10
spring.jpa.open-in-view=false
spring.jpa.properties.hibernate.jdbc.batch_size=50

! Values stay strings: 08 and on are quoted in YAML
app.order.number-prefix=08
app.feature-flags.[new.checkout]=on
app.welcome-message=Willkommen im Shop, \\
    sch\\u00f6n dass du da bist
app.cors.allowed-origins[0]=https://shop.example.com
app.cors.allowed-origins[1]=http://localhost:5173
app.retry[0].name=payment
app.retry[0].max-attempts=3
app.retry[1].name=email
app.retry[1].max-attempts=5
app.cleanup-cron=0 0 3 * * *

management.endpoints.web.exposure.include=health,info,prometheus
logging.level.com.example.shop=DEBUG
#---
spring.config.activate.on-profile=prod
server.port=80
spring.datasource.hikari.maximum-pool-size=30
logging.level.com.example.shop=INFO
`;

const SAMPLE_YAML = `spring:
  application:
    name: shop-service
  datasource:
    url: jdbc:postgresql://localhost:5432/shop
    username: shop
    password: \${DB_PASSWORD:changeme}
  jpa:
    open-in-view: false
server:
  port: 8080
app:
  order:
    number-prefix: "08"
  feature-flags:
    "[new.checkout]": "on"
  cors:
    allowed-origins:
      - https://shop.example.com
      - http://localhost:5173
  retry:
    - name: payment
      max-attempts: 3
    - name: email
      max-attempts: 5
logging:
  level:
    com.example.shop: DEBUG
---
spring:
  config:
    activate:
      on-profile: prod
server:
  port: 80
`;

const dir = useStorage<Dir>("devtools:spring-properties-yaml:dir", "p2y");
const input = useStorage("devtools:spring-properties-yaml:input", SAMPLE_PROPS);
const ascii = useStorage("devtools:spring-properties-yaml:ascii", true);
const group = useStorage("devtools:spring-properties-yaml:group", true);

const fromLabel = computed(() => (dir.value === "p2y" ? "application.properties" : "application.yml"));
const toLabel = computed(() => (dir.value === "p2y" ? "application.yml" : "application.properties"));

const result = computed(() => (dir.value === "p2y" ? propertiesToYaml(input.value) : yamlToProperties(input.value, { ascii: ascii.value, group: group.value })));

function sample() {
    input.value = dir.value === "p2y" ? SAMPLE_PROPS : SAMPLE_YAML;
}

function swap() {
    const r = result.value;
    dir.value = dir.value === "p2y" ? "y2p" : "p2y";
    if (r.out && !r.error) input.value = r.out;
}

async function paste() {
    input.value = await readClipboard();
}

// Input sent from the chat assistant.
useHandoff<{ input?: string; direction?: Dir }>("spring-properties-yaml", (p) => {
    if (p.direction === "p2y" || p.direction === "y2p") dir.value = p.direction;
    if (p.input != null) {
        input.value = p.input;
        // Guess the direction when the caller did not say.
        if (!p.direction) dir.value = /^[\w-]+(\.[\w-]+|\[[^\]]*\])+\s*[=:\s]/m.test(p.input) && !/^\s+[\w-]+:/m.test(p.input) ? "p2y" : "y2p";
    }
});
</script>

<template>
    <ToolPage>
        <template #actions>
            <Tabs
                v-model="dir"
                :options="[
                    { value: 'p2y', label: 'Properties → YAML' },
                    { value: 'y2p', label: 'YAML → Properties' },
                ]"
            />
        </template>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <Btn size="sm" variant="secondary" title="Swap direction and move the output to the input" @click="swap"><ArrowLeftRight /> Swap</Btn>
            <template v-if="dir === 'y2p'">
                <label class="flex items-center gap-2"><input v-model="ascii" type="checkbox" class="checkbox" /> Escape non-ASCII as \uXXXX</label>
                <label class="flex items-center gap-2"><input v-model="group" type="checkbox" class="checkbox" /> Blank line between top-level groups</label>
            </template>
            <span v-if="result.docs > 1" class="chip">{{ result.docs }} documents</span>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
            <Panel :title="fromLabel" flush>
                <template #actions>
                    <Btn size="sm" variant="ghost" @click="sample"><Sparkles /> Sample</Btn>
                    <Btn size="sm" variant="ghost" @click="paste"><ClipboardPaste /> Paste</Btn>
                    <Btn size="sm" variant="ghost" :disabled="!input" @click="input = ''"><Trash2 /> Clear</Btn>
                </template>
                <CodeArea
                    v-model="input"
                    :language="dir === 'p2y' ? 'ini' : 'yaml'"
                    :wrap="false"
                    :invalid="!!result.error"
                    height="28rem"
                    :placeholder="dir === 'p2y' ? 'Paste application.properties here…' : 'Paste application.yml here…'"
                />
            </Panel>
            <Panel :title="toLabel" flush>
                <template #actions><CopyButton :text="result.out" /></template>
                <div v-if="result.error" class="p-4"><Notice type="error">{{ result.error }}</Notice></div>
                <CodeArea v-else :model-value="result.out" :language="dir === 'p2y' ? 'yaml' : 'ini'" readonly :wrap="false" height="28rem" placeholder="Output appears here" />
            </Panel>
        </div>

        <Panel v-if="result.notes.length" title="Notes">
            <ul class="list-disc space-y-1 pl-5 text-sm text-fg-muted">
                <li v-for="(n, i) in result.notes" :key="i">{{ n }}</li>
            </ul>
        </Panel>

        <p class="text-xs text-muted">
            Keys like <span class="code">a.b[0].c</span> become nested YAML maps and lists, and back. Separators <span class="code">=</span>, <span class="code">:</span> and whitespace,
            <span class="code">\</span> line continuations and <span class="code">\uXXXX</span> escapes are read as java.util.Properties does. Values are kept as strings and quoted in YAML
            when SnakeYAML would read them differently (<span class="code">08</span>, <span class="code">on</span>, <span class="code">12:30</span>). Profile documents use
            <span class="code">#---</span> in properties and <span class="code">---</span> in YAML; map keys with dots keep the <span class="code">[bracket]</span> notation.
        </p>
    </ToolPage>
</template>
