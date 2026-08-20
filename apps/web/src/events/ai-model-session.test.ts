import { expect, test, vi } from "vitest";
import type { ModelLike, TokenClaims } from "./ai-model-session.js";
import { createAiModelSession } from "./ai-model-session.js";

/** Un modelo falso: no hay SDK que simular, sólo la forma que usa la sesión. */
function fakeModel(
	overrides: Partial<{
		generateContent: ModelLike["generateContent"];
		initializeDeviceModel: ModelLike["initializeDeviceModel"];
	}> = {},
): ModelLike {
	return {
		initializeDeviceModel: vi.fn(
			overrides.initializeDeviceModel ?? (async () => {}),
		),
		generateContent: vi.fn(
			overrides.generateContent ??
				(async () => ({
					response: { text: () => "{}", inferenceSource: "on_device" },
				})),
		),
	};
}

const baseOptions = (buildModel: (mode: string) => Promise<ModelLike>) => ({
	getUser: () => null,
	buildModel,
});

test("genera a partir de las partes y devuelve dónde se resolvió", async () => {
	const model = fakeModel({
		generateContent: async () => ({
			response: {
				text: () => '{"title":"Cena"}',
				inferenceSource: "on_device",
			},
		}),
	});
	const session = createAiModelSession(baseOptions(async () => model));

	const result = await session.generate([{ text: "hola" }]);

	expect(result.text).toBe('{"title":"Cena"}');
	expect(result.source).toBe("on_device");
	expect(model.generateContent).toHaveBeenCalledWith({
		contents: [{ role: "user", parts: [{ text: "hola" }] }],
	});
});

test("el modelo se construye una sola vez, no una por llamada", async () => {
	const model = fakeModel();
	const buildModel = vi.fn(async () => model);
	const session = createAiModelSession(baseOptions(buildModel));

	await session.generate([{ text: "uno" }]);
	await session.generate([{ text: "dos" }]);
	await session.warmUp(() => {});

	expect(buildModel).toHaveBeenCalledTimes(1);
});

test("un fallo al construir el modelo no envenena la sesión entera", async () => {
	// El fallo que se coló en T23: un rechazo memoizado dejaba la IA muerta
	// hasta recargar la página, aunque la causa fuera pasajera.
	let intentos = 0;
	const model = fakeModel();
	const buildModel = async () => {
		intentos++;
		if (intentos === 1) throw new Error("red floja");
		return model;
	};
	const session = createAiModelSession(baseOptions(buildModel));

	await expect(session.generate([{ text: "x" }])).rejects.toThrow("red floja");
	// El segundo intento, con la red recuperada, sí genera.
	await expect(session.generate([{ text: "x" }])).resolves.toMatchObject({
		text: "{}",
	});
	expect(intentos).toBe(2);
});

test("un fallo al descargar el modelo no impide reintentar el calentamiento", async () => {
	let intentos = 0;
	const model = fakeModel({
		initializeDeviceModel: async () => {
			intentos++;
			if (intentos === 1) throw new Error("descarga interrumpida");
		},
	});
	const session = createAiModelSession(baseOptions(async () => model));

	await expect(session.warmUp(() => {})).rejects.toThrow(
		"descarga interrumpida",
	);
	await expect(session.warmUp(() => {})).resolves.toBeUndefined();
	expect(intentos).toBe(2);
});

test("warmUp llamado dos veces a la vez sólo descarga una", async () => {
	const model = fakeModel();
	const session = createAiModelSession(baseOptions(async () => model));

	await Promise.all([session.warmUp(() => {}), session.warmUp(() => {})]);

	expect(model.initializeDeviceModel).toHaveBeenCalledTimes(1);
});

test("el progreso de descarga llega como porcentaje, no como fracción", async () => {
	const vistos: number[] = [];
	const model = fakeModel({
		initializeDeviceModel: async (onProgress) => {
			onProgress(0.5);
		},
	});
	const session = createAiModelSession(baseOptions(async () => model));

	await session.warmUp((percent) => vistos.push(percent));

	expect(vistos).toEqual([50]);
});

test("se avisa del modo de inferencia resuelto", async () => {
	const model = fakeModel();
	let visto: string | undefined;

	const session = createAiModelSession({
		...baseOptions(async () => model),
		onInferenceMode: (mode) => {
			visto = mode;
		},
	});

	await session.generate([{ text: "x" }]);

	// El candado de ai-policy fuerza este modo hoy; lo importante es que se
	// avise de lo que de verdad se resolvió, no que se adivine en la plantilla.
	expect(visto).toBe("only_on_device");
});

test("el modo resuelto es el que recibe quien construye el modelo", async () => {
	const model = fakeModel();
	let recibido: string | undefined;

	const session = createAiModelSession({
		getUser: () => null,
		buildModel: async (mode) => {
			recibido = mode;
			return model;
		},
	});

	await session.generate([{ text: "x" }]);

	expect(recibido).toBe("only_on_device");
});

test("un fallo al leer el claim de premium no rompe la resolución del modo", async () => {
	vi.stubEnv("VITE_AI_CLOUD_FALLBACK", "true");
	try {
		const model = fakeModel();
		const claims: TokenClaims = {
			getIdTokenResult: async () => {
				throw new Error("token caducado");
			},
		};
		const session = createAiModelSession({
			getUser: () => claims,
			buildModel: async () => model,
		});

		await expect(session.generate([{ text: "x" }])).resolves.toMatchObject({
			text: "{}",
		});
	} finally {
		vi.unstubAllEnvs();
	}
});

test("sin la nube abierta, no se llega ni a mirar el claim de premium", async () => {
	const model = fakeModel();
	const getIdTokenResult = vi.fn();
	const session = createAiModelSession({
		getUser: () => ({ getIdTokenResult }),
		buildModel: async () => model,
	});

	await session.generate([{ text: "x" }]);

	expect(getIdTokenResult).not.toHaveBeenCalled();
});
