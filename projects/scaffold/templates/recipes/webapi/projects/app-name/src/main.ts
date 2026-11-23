import { createApp } from "./app.js";

const app = await createApp();
await app.start({ port: Number(process.env.PORT ?? 3000) });
export default app;
