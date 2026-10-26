# Cyberpunk Mod Manager

this works ui is for nerds

A small Electron app for installing Cyberpunk 2077 mods from `.zip` archives.

- Install one or more mod zips at once, with a progress bar
- Search your installed mods
- Disable a mod without deleting it (its files are moved into `.cmm-disabled/` in the game folder) and enable it again later
- Delete mods, removing every file they installed

## Download

Grab a build from the [Releases](https://github.com/Dravilias/Cyberpunk-Mod-Manager/releases) page:

- **Windows:** `Cyberpunk Mod Manager Setup x.y.z.exe` (installer) or `Cyberpunk Mod Manager x.y.z Portable.exe` (no install)
- **Linux:** `cyberpunk-mod-manager-x.y.z.AppImage`, or the `.tar.gz` which contains the `cyberpunk-mod-manager` executable

On Linux, make the AppImage executable and run it:

```sh
chmod +x cyberpunk-mod-manager-*.AppImage
./cyberpunk-mod-manager-*.AppImage
```

## Development

```sh
npm install
npm start
```

## Building

```sh
npm run dist:win     # Windows installer + portable exe, in dist/
npm run dist:linux   # Linux AppImage + tar.gz, in dist/ (AppImage must be built on Linux)
```

Pushing a version tag builds both platforms on GitHub Actions and attaches them to a release:

```sh
git tag v1.0.0
git push origin v1.0.0
```
