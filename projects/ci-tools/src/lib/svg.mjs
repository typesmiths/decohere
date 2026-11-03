/**
 * Shared SVG badge generation utilities.
 */

/**
 * Returns a badge color for a given line-coverage percentage.
 * @param {number} percentage
 * @returns {string}
 */
export function getColor(percentage) {
	if (percentage >= 90) return "#2ea043";
	if (percentage >= 80) return "#3fb950";
	if (percentage >= 70) return "#9a6700";
	if (percentage >= 60) return "#db6d28";
	return "#cf222e";
}

/**
 * Creates a two-section labeled badge SVG string.
 * @param {string} label
 * @param {string} value
 * @param {string} color  Hex color for the value section.
 * @returns {string}
 */
export function createBadgeSvg(label, value, color) {
	const labelWidth = Math.max(50, 10 + label.length * 7);
	const valueWidth = Math.max(44, 10 + value.length * 7);
	const totalWidth = labelWidth + valueWidth;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <rect width="${labelWidth}" height="20" fill="#24292f"/>
  <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
  <text x="${labelWidth / 2}" y="14" fill="#ffffff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">${label}</text>
  <text x="${labelWidth + valueWidth / 2}" y="14" fill="#ffffff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">${value}</text>
</svg>\n`;
}

/**
 * Maps a GitHub Actions workflow run status/conclusion to a badge color.
 * @param {string} status
 * @param {string | null} conclusion
 * @returns {string}
 */
export function statusToColor(status, conclusion) {
	if (status === "in_progress" || status === "queued") return "#fb8500";
	if (conclusion === "success") return "#2ea043";
	if (conclusion === "failure") return "#cf222e";
	if (conclusion === "cancelled") return "#6e7781";
	return "#6e7781";
}

/**
 * Maps a GitHub Actions workflow run status/conclusion to a human-readable label.
 * @param {string} status
 * @param {string | null} conclusion
 * @returns {string}
 */
export function statusToText(status, conclusion) {
	if (status === "in_progress") return "running";
	if (status === "queued") return "queued";
	if (conclusion === "success") return "passing";
	if (conclusion === "failure") return "failing";
	if (conclusion === "cancelled") return "cancelled";
	return "unknown";
}
