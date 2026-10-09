<script lang="ts">
	let {
		value = $bindable(500),
		min = 360,
		max = 840
	}: {
		value?: number;
		min?: number;
		max?: number;
	} = $props();
	let drag: { id: number; x: number; value: number } | undefined;
	type PointerInput = PointerEvent & { currentTarget: HTMLDivElement };

	function resize(next: number) {
		value = Math.round(Math.max(min, Math.min(max, next)));
	}

	function start(event: PointerInput) {
		if (drag || !event.isPrimary || event.button !== 0) return;
		drag = { id: event.pointerId, x: event.clientX, value };
		event.currentTarget.setPointerCapture(event.pointerId);
	}

	function move(event: PointerInput) {
		if (event.pointerId !== drag?.id) return;
		resize(drag.value - (event.clientX - drag.x));
	}

	function end(event: PointerInput) {
		if (event.pointerId !== drag?.id) return;
		drag = undefined;
		if (event.currentTarget.hasPointerCapture(event.pointerId))
			event.currentTarget.releasePointerCapture(event.pointerId);
	}

	function keydown(event: KeyboardEvent) {
		const step = window.innerWidth / 100;
		if (event.key === 'ArrowLeft') resize(value + step);
		else if (event.key === 'ArrowRight') resize(value - step);
		else if (event.key === 'Home') resize(min);
		else if (event.key === 'End') resize(max);
		else return;
		event.preventDefault();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions (ARIA makes a focusable separator an adjustable widget.) -->
<div
	class="splitter"
	role="separator"
	tabindex="0"
	aria-label="Resize details panel"
	aria-controls="catalog-inspector"
	aria-orientation="vertical"
	aria-valuemin={min}
	aria-valuemax={max}
	aria-valuenow={value}
	aria-valuetext={`${value} pixels`}
	onpointerdown={start}
	onpointermove={move}
	onpointerup={end}
	onpointercancel={end}
	onlostpointercapture={end}
	onkeydown={keydown}
></div>
