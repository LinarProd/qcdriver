.PHONY: all module install reload dkms pkg-arch pkg-deb install-web pkg-web-arch pkg-web-deb clean

all: module

module:
	scripts/build.sh

install: module
	sudo scripts/install.sh
	sudo daemon/install-daemon.sh
	sudo gui/install-gui.sh

reload:
	scripts/reload.sh

dkms:
	sudo scripts/install-dkms.sh

pkg-arch:
	packaging/arch/build-package.sh

pkg-deb:
	packaging/debian/build-deb.sh

install-web:
	sudo webgui/install-web.sh

pkg-web-arch:
	webgui/packaging/arch/build-package.sh

pkg-web-deb:
	webgui/packaging/debian/build-deb.sh

clean:
	$(MAKE) -C /lib/modules/$(shell uname -r)/build M=$(CURDIR)/module clean
