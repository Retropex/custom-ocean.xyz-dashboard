#!/usr/bin/env python3
import os
import jsmin

def minify_js_files():
    """Minify JavaScript files."""
    js_dir = 'static/js'
    min_dir = os.path.join(js_dir, 'min')
    os.makedirs(min_dir, exist_ok=True)
    
    minified_count = 0
    for js_file in os.listdir(js_dir):
        if js_file.endswith('.js') and not js_file.endswith('.min.js'):
            input_path = os.path.join(js_dir, js_file)
            output_path = os.path.join(min_dir, js_file.replace('.js', '.min.js'))
            
            with open(input_path, 'r') as f:
                js_content = f.read()
            
            # Minify the content
            minified = jsmin.jsmin(js_content)
            
            # Write minified content
            with open(output_path, 'w') as f:
                f.write(minified)
            
            minified_count += 1
            print(f"Minified {js_file}")
    
    print(f"Total files minified: {minified_count}")

if __name__ == "__main__":
    minify_js_files()