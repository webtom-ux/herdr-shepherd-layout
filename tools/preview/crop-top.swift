// Cuts the top rows off a PNG in place: swift crop-top.swift <file.png> <rows>
// (sips can only crop around the centre.)
import CoreGraphics
import Foundation
import ImageIO

let url = URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL
let rows = Int(CommandLine.arguments[2])!
guard let src = CGImageSourceCreateWithURL(url, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil),
      let cut = img.cropping(to: CGRect(x: 0, y: rows, width: img.width, height: img.height - rows)),
      let out = CGImageDestinationCreateWithURL(url, "public.png" as CFString, 1, nil) else { exit(1) }
CGImageDestinationAddImage(out, cut, nil)
exit(CGImageDestinationFinalize(out) ? 0 : 1)
