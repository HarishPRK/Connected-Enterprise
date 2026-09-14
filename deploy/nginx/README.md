# Twin Studio chat origin forwarding

The Studio host runs through nginx on the GW-Operational-Twin EC2 instance
(`i-0b23c23b6f85d58bf`, port 8081). Its frontend and `/api/twin-agent/chat`
handler are served upstream from `https://gemtek.connectedenterprise.app`.

Install `gemtek-studio-agent-origin.conf` in `/etc/nginx/conf.d/`. In the
`location /` block of `gemtek-http-proxy.conf`, add:

```nginx
proxy_set_header Origin $gemtek_studio_agent_origin;
```

The map translates the origin only when the chat path, public Host and browser
Origin all match Studio. It does not allow wildcard origins, change CORS,
alter device-control endpoints, or remove the upstream request gate.
Validate with `nginx -t` before reloading nginx.

Verification: POST an empty JSON object to Studio's `/api/twin-agent/chat`.
The matching Studio origin should reach request validation (HTTP 400,
`Invalid agent request`); a foreign or `null` origin must receive HTTP 403.
Then submit a diagnosis question in the embedded Studio and confirm an answer.
