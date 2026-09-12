# Gateway Digital Twin Studio

The `/gateway-twin` page embeds Gemtek Digital Twin Studio from
`https://studio.connectedenterprise.app/`. This HTTPS origin serves the same
application as the requested source:
`http://ce-public-alb-1719524608.us-east-1.elb.amazonaws.com:8080/`.
HTTPS is required when embedding inside `https://connectedenterprise.app`.

The studio owns its 3D views, telemetry, scenarios and device controls. It does
not implement the former `gw-twin` postMessage API. The dashboard therefore
provides reload, open-in-new-tab and fullscreen controls, and leaves branch
selection independent of the studio's own gateway feed. Ctrl/Cmd+K opens the
dashboard command palette consistently on this page.

## Hosting

- Region: `us-east-1`
- Load balancer: `ce-public-alb`
- HTTPS listener: port `443`
- Host rule: `studio.connectedenterprise.app`, priority `110`
- Target group: `gemtek-http8081-tg`, same target as HTTP listener `8080`
- Target: instance `i-0b23c23b6f85d58bf`, port `8081`
- DNS: CNAME `studio.connectedenterprise.app` to the load balancer DNS name
- Route 53 zone: `Z086513319N9XKJZQ7AAF`
- ACM certificate: `e38e0062-c15f-4f8c-afea-f2dd590bc562`, DNS validated

Retain the ACM validation CNAME for certificate renewal. The existing
`twin.connectedenterprise.app` host rule and the public port `8080` remain
independent. No authentication, security group, or legacy twin configuration
changes are required for this embed.

## Verify

Open `/gateway-twin` from the HTTPS dashboard. Confirm the Gemtek studio loads
inside the frame, its 3D model renders, live telemetry connects, and Interior /
Exterior views work. Check reload, fullscreen and the command palette. The
parent page's iframe load event indicates document loading only; the studio
reports its own connection and initialization state.
