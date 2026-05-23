import { mount } from "svelte";
import "katex/dist/katex.min.css";
import "./app/app.css";
import App from "./app/App.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("#app element not found");

const app = mount(App, { target });

export default app;
