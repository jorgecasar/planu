import { msg } from "@lit/localize";

/** Which of the two inputs the current generation came from. */
export type WorkingOn = "image" | "text";

/**
 * What's happening right now, phrased with the words of the input that
 * triggered it.
 *
 * Lives outside the component so it can be tested: the message once said
 * "Reading the image…" while a pasted text was being read, and no test could
 * catch it because it was embedded in the template.
 */
export function progressMessage(state: {
	preparing: boolean;
	downloading: boolean;
	uploading: boolean;
	on: WorkingOn;
}): string {
	if (state.downloading) {
		return msg("Downloading the AI model, this can take a few minutes…");
	}
	if (state.preparing) return msg("Getting the AI model ready…");
	if (state.uploading) return msg("Saving the image…");
	return state.on === "text"
		? msg("Reading your text and pulling out the event…")
		: msg("Reading the image and pulling out the event…");
}

/**
 * The second line: why the wait is worth it.
 *
 * The model runs on the device, so neither the text nor the photo leave here.
 * Saying so while waiting turns an uncomfortable silence into the reason it
 * takes a while.
 */
export function progressHint(state: {
	downloading: boolean;
	uploading: boolean;
	onDevice: boolean;
}): string {
	if (state.downloading) {
		return msg("It only happens once. You can leave this open.");
	}
	// The cover image **does** leave the device: it's saved to your account.
	// Promising here that nothing leaves would be a lie exactly at the moment
	// it stops being true.
	if (state.uploading) return msg("The image is saved to your account.");
	return state.onDevice
		? msg("It runs on your device: nothing you wrote leaves it.")
		: msg("This can take a few seconds.");
}
