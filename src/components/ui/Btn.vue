<script setup lang="ts">
withDefaults(
    defineProps<{
        variant?: "primary" | "secondary" | "ghost" | "danger";
        size?: "sm" | "md";
        type?: "button" | "submit";
        disabled?: boolean;
    }>(),
    { variant: "secondary", size: "md", type: "button" },
);
</script>

<template>
    <button
        :type="type"
        :disabled="disabled"
        class="inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-[transform,background-color,color,opacity,filter] duration-150 select-none active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 [&_svg]:size-4 [&_svg]:stroke-[1.75]"
        :class="[
            size === 'sm' ? 'h-7 px-2 text-xs' : 'h-10 px-3 text-sm leading-6',
            {
                'bg-signal font-semibold text-white shadow-[0_6px_18px_-8px_rgba(91,70,245,0.7)] hover:brightness-110': variant === 'primary',
                'bg-subtle text-fg ring-1 ring-line ring-inset hover:bg-surface': variant === 'secondary',
                'text-fg-subtle hover:bg-subtle hover:text-fg': variant === 'ghost',
                'bg-danger font-semibold text-surface hover:opacity-90': variant === 'danger',
            },
        ]"
    >
        <slot />
    </button>
</template>
