# Maintainer: nikm3r <nmermigkas@gmail.com>
pkgname=anitrack
pkgver=0.4.15
pkgrel=1
pkgdesc="Anime tracking desktop app with AniList sync, torrent search and sync watch"
arch=('x86_64')
url="https://github.com/nikm3r/AniTrack"
license=('MIT')
depends=('gtk3' 'nss' 'alsa-lib' 'libxtst' 'libxss' 'libxrandr' 'mesa' 'libdrm' 'fuse2')
options=(!strip)
source=("${pkgname}-${pkgver}.AppImage::https://github.com/nikm3r/AniTrack/releases/download/v${pkgver}/anitrack-${pkgver}.AppImage")
sha256sums=('SKIP')

package() {
  install -dm755 "${pkgdir}/opt/anitrack"
  install -Dm755 "${srcdir}/${pkgname}-${pkgver}.AppImage" \
    "${pkgdir}/opt/anitrack/anitrack"

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
}
