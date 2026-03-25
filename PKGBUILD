# Maintainer: nikm3r <nmermigkas@gmail.com>
pkgname=anitrack
pkgver=0.4.3
pkgrel=1
pkgdesc="Anime tracking desktop app with AniList sync, torrent search and sync watch"
arch=('x86_64')
url="https://github.com/nikm3r/AniTrack"
license=('MIT')
depends=('gtk3' 'nss' 'alsa-lib' 'libxtst' 'libxss' 'libxrandr' 'mesa' 'libdrm')
options=(!strip)
source=("${pkgname}-${pkgver}.zip::https://github.com/nikm3r/AniTrack/releases/download/v${pkgver}/anitrack-linux-x64-${pkgver}.zip")
sha256sums=('SKIP')

package() {
  local srcdir_inner="${srcdir}/anitrack-linux-x64"

  install -dm755 "${pkgdir}/opt/anitrack"
  cp -r "${srcdir_inner}/"* "${pkgdir}/opt/anitrack/"

  chmod +x "${pkgdir}/opt/anitrack/anitrack"

  install -dm755 "${pkgdir}/usr/bin"
  ln -sf "/opt/anitrack/anitrack" "${pkgdir}/usr/bin/anitrack"

  install -dm755 "${pkgdir}/usr/share/applications"
  cat > "${pkgdir}/usr/share/applications/anitrack.desktop" << DESKTOP
[Desktop Entry]
Name=AniTrack
Comment=Anime tracking desktop app with AniList sync and sync watch
Exec=anitrack %U
Icon=anitrack
Type=Application
Categories=AudioVideo;Video;
Terminal=false
StartupNotify=true
StartupWMClass=anitrack
DESKTOP

  install -dm755 "${pkgdir}/usr/share/icons/hicolor/256x256/apps"
  if [ -f "${srcdir_inner}/icon.png" ]; then
    install -Dm644 "${srcdir_inner}/icon.png" \
      "${pkgdir}/usr/share/icons/hicolor/256x256/apps/anitrack.png"
  fi
  install -dm755 "${pkgdir}/usr/share/pixmaps"
  if [ -f "${srcdir_inner}/icon.png" ]; then
    install -Dm644 "${srcdir_inner}/icon.png" \
      "${pkgdir}/usr/share/pixmaps/anitrack.png"
  fi
}
