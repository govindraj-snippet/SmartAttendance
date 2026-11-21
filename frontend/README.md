# React + Vite

## Open the development site on a phone

1. Connect the phone and development computer to the same Wi-Fi network.
2. Find the computer's Wi-Fi IPv4 address (on Linux, run `ip -4 addr show` and look for the `inet` address on the Wi-Fi interface).
3. Keep the Vite development server running, then open `http://<computer-ip>:5173/` on the phone. For example: `http://192.168.1.20:5173/`.

Do not use `localhost` or `127.0.0.1` on the phone; those addresses refer to the phone itself. The app's `/api` requests are proxied by Vite to the local backend.

The HTTP development URL can display the site, but mobile browsers require a secure HTTPS origin for camera and location access. QR scanning may therefore need a trusted HTTPS setup on the development computer and phone.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.
