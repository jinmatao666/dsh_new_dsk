# One API frontend themes

English | [中文](README.zh.md)

> Each folder represents a theme. Contributions of new themes are welcome.

> [!WARNING]
> Not every theme includes every feature update. The recommended default is the `air` theme; pull requests for other themes are welcome.

## Contribute a new theme

> You are welcome to retain your copyright information and One API copyright information, with links, at the bottom of the page.

1. Create a folder under `web`, named after your theme.
2. Put your theme files in that folder.
3. In `package.json`, set the `build` command to `"build": "react-scripts build && mv -f build ../build/your-theme"`, replacing `your-theme` with your theme name.
4. Register your theme name in `ValidThemes` in `common/config/config.go`.
5. Also update `web/THEMES`.

## Theme list

### Theme: berry

Developed by [MartialBE](https://github.com/MartialBE).

Preview:
|||
|:---:|:---:|
|![image](https://github.com/songquanpeng/one-api/assets/42402987/36aff5c6-c5ff-4a90-8e3d-33d5cff34cbf)|![image](https://github.com/songquanpeng/one-api/assets/42402987/9ac63b36-5140-4064-8fad-fc9d25821509)|
|![image](https://github.com/songquanpeng/one-api/assets/42402987/fb2b1c64-ef24-4027-9b80-0cd9d945a47f)|![image](https://github.com/songquanpeng/one-api/assets/42402987/b6b649ec-2888-4324-8b2d-d5e11554eed6)|
|![image](https://github.com/songquanpeng/one-api/assets/42402987/6d3b22e0-436b-4e26-8911-bcc993c6a2bd)|![image](https://github.com/songquanpeng/one-api/assets/42402987/eef1e224-7245-44d7-804e-9d1c8fa3f29c)|

### Theme: air
Developed by [Calon](https://github.com/Calcium-Ion).

|![image](https://github.com/songquanpeng/songquanpeng.github.io/assets/39998050/1ddb274b-a715-4e81-858b-857d520b6ff4)|![image](https://github.com/songquanpeng/songquanpeng.github.io/assets/39998050/163b0b8e-1f73-49cb-b632-3dcb986b56d5)|
|:---:|:---:|

#### Development notes

See [web/berry/README.md](https://github.com/songquanpeng/one-api/tree/main/web/berry/README.md).
