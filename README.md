# Arctic Fox Web Browser

Arctic Fox starts a forked and rebranded Pale Moon 27.9.4 and retains it _classic_ interface. Many fixes and enhancements have been imported from Firefox and TenFourFox.

Arctic Fox aims to be a desktop oriented browser, phone support has been removed or not updated in the tree.

The goal here is to implement specific security updates and bug fixes to keep this browser as up to date as possible for aging systems. Examples would be Mac OSX 10.6-10.8, PowerPC's running Linux, etc.

Arctic Fox will build for Mac OS X 10.6 and up, Windows XP, i386/x86_64/PowerPC Linux, and more than likely any other unix/bsd varient. Ideally, we'd like to get it working on PowerPC 10.5 as well. An older *unofficial 10.4/10.5 build can be found here: [Arctic Fox for 10.4/10.5](https://forums.macrumors.com/threads/so-this-finally-happened-sort-of.2172031/)

## Build tips

With enough swap, 1.2GB of RAM are the absolute minimum tested, 1.5GB is acceptable, 2GB is comfortable, 4GB is recommended. For some tricks, read below.

* To build on MacOSX:
* Requires OS X 10.6 as a minimum build environment.
* Install xcode, command line tools and macports. 
* Install these via macports: 
* sudo port -v install autoconf213 python27 libidl ccache yasm clang-3.7 (clang-3.7 is the minimum known to work). 
* Extract source archive somewhere convenient. 
* Add a sane .mozconfig (i've included some samples). 
* From the source directory type: ./mach build 
* If it builds (takes about 1 hour on a core2duo) test it with: ./mach run 
* Now package it: ./mach package 
* The built package will be in /obj_blah_blah/dist 


* To Build on Linux
* GCC is supported up to version gcc 6.5, later versions show linking issues

* To Build On FreeBSD
* use clang 6 from ports

* To Build on OpenBSD
* latest clang tried (8.0) needs -O0 or it will generate a crashing binary
* add LDFLAGS="-Wl,-z,wxneeded"
* add TAR=gtar

* To Build on NetBSD
* every gcc version tested worked, system one being OK up to gcc8! compared to Linux, no issues

If you are under memory pressure, try:
* use -g0 in your optimization flags (removes debug information, greatly reducing file sizes)

## What has been removed compared to FireFox?
* translation support through translations services
* social panel
* WebRTC
* Android support
* metro support

## Resources

 * [Mozilla Source Code Directory Structure and links to project pages](https://developer.mozilla.org/en/Mozilla_Source_Code_Directory_Structure)
 * [Build Arctic Fox for Windows](https://forum.palemoon.org/viewtopic.php?f=19&t=13556)
 * [Build Arctic Fox for Linux](https://developer.palemoon.org/Developer_Guide:Build_Instructions/Pale_Moon/Linux)
 
 ## Downloads and Add-ons
  See the *WIKI* tab for prebuilt binary download links.
  
 ## Thanks to...
  * The Pale Moon team for making a great browser to base this off of.
  * The TenFourFox team. We borrow or backport a lot of their stuff.

