import { mountApp } from "./app.js";

const root = document.getElementById("app");
if (!root) throw new Error("missing #app root");
mountApp(root);
