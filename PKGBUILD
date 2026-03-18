# Maintainer: nikm3r <nmermigkas@gmail.com>
pkgname=anitrack
pkgver=1.0.0
pkgrel=1
pkgdesc="Anime tracking desktop app with AniList sync, torrent search and sync watch"
arch=('x86_64')
url="https://github.com/nikm3r/AniTrack"
license=('MIT')
depends=('gtk3' 'nss' 'alsa-lib' 'libxtst' 'libxss')
options=(!strip)

source=("https://github.com/nikm3r/AniTrack/releases/download/v${pkgver}/anitrack-linux-x64-${pkgver}.zip")
sha256sums=('SKIP')

package() {
  # Install app files
  install -dm755 "${pkgdir}/opt/anitrack"
  cp -r "${srcdir}/anitrack-linux-x64/"* "${pkgdir}/opt/anitrack/"

  # Make executable
  chmod +x "${pkgdir}/opt/anitrack/anitrack"

  # Symlink to /usr/bin
  install -dm755 "${pkgdir}/usr/bin"
  ln -sf "/opt/anitrack/anitrack" "${pkgdir}/usr/bin/anitrack"

  # Desktop entry
  install -dm755 "${pkgdir}/usr/share/applications"
  cat > "${pkgdir}/usr/share/applications/anitrack.desktop" << DESKTOP
[Desktop Entry]
Name=AniTrack
Comment=Anime tracking desktop app
Exec=anitrack
Icon=anitrack
Type=Application
Categories=AudioVideo;Video;
Terminal=false
DESKTOP

  # Icon
  install -dm755 "${pkgdir}/usr/share/pixmaps"
  cp "${srcdir}/anitrack-linux-x64/resources/app.asar/icon.png" \
     "${pkgdir}/usr/share/pixmaps/anitrack.png" 2>/dev/null || true
}
