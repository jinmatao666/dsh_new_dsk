# Shared coming-soon page

English | [中文](README.zh.md)

This standalone static page displays a shared unavailable-expert notice. It has no upload, login, model, task, storage, bridge or usage-reporting API. It immediately discards the launch fragment without reading or redeeming its ticket; the platform-issued ticket expires normally. It does not claim that a service is available or promise a launch date.

Run `python preview.py` in this directory to print a loopback preview URL. Run `node --test test_page.mjs` for the focused static checks. The HTML is self-contained and can be copied to an existing static web server without repository dependencies. The illustration is decorative; the header embeds the exact approved brand path, retained locally in `assets/brand-mark.svg`, without requesting another image or reading another project at runtime.

For production, make the file available inside the existing gateway container, then add [nginx.location.conf.example](nginx.location.conf.example) inside its existing 3300 server. The example assumes the file is at `/usr/share/nginx/wanwei-coming-soon/index.html` inside the container; verify the actual mount before use. If the container cannot already see that directory, adding a location alone is insufficient. Arrange the mount change separately without overwriting other gateway configuration. Validate with `nginx -t`, reload safely and check an actual request. Container deployment is not locally verified.

The intended shared workbench URL is `http://ac.zjugis.com:3300/experts/coming-soon/`. After deployment, multiple unpublished expert cards can use this same URL; keep their keys and provider credentials distinct. The page does not consume credentials and does not record use. Once an expert is ready, change only that card to its real workbench URL. This work does not update existing cards or production routes.
