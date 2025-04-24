#!/usr/bin/env python3
import os
import jsmin
import htmlmin
import logging
from pathlib import Path

# Set up logging
logging.basicConfig(level=logging.INFO, 
                   format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def minify_js_files():
    """Minify JavaScript files."""
    js_dir = 'static/js'
    min_dir = os.path.join(js_dir, 'min')
    os.makedirs(min_dir, exist_ok=True)
    
    minified_count = 0
    skipped_count = 0
    
    for js_file in os.listdir(js_dir):
        if js_file.endswith('.js') and not js_file.endswith('.min.js'):
            try:
                input_path = os.path.join(js_dir, js_file)
                output_path = os.path.join(min_dir, js_file.replace('.js', '.min.js'))
                
                # Skip already minified files if they're newer than source
                if os.path.exists(output_path) and \
                   os.path.getmtime(output_path) > os.path.getmtime(input_path):
                    logger.info(f"Skipping {js_file} (already up to date)")
                    skipped_count += 1
                    continue
                
                with open(input_path, 'r', encoding='utf-8') as f:
                    js_content = f.read()
                
                # Minify the content
                minified = jsmin.jsmin(js_content)
                
                # Write minified content
                with open(output_path, 'w', encoding='utf-8') as f:
                    f.write(minified)
                
                size_original = len(js_content)
                size_minified = len(minified)
                reduction = (1 - size_minified / size_original) * 100 if size_original > 0 else 0
                
                logger.info(f"Minified {js_file} - Reduced by {reduction:.1f}%")
                minified_count += 1
            except Exception as e:
                logger.error(f"Error processing {js_file}: {e}")
    
    logger.info(f"JavaScript minification: {minified_count} files minified, {skipped_count} files skipped")
    return minified_count

def minify_css_files():
    """Minify CSS files using simple compression techniques."""
    css_dir = 'static/css'
    min_dir = os.path.join(css_dir, 'min')
    os.makedirs(min_dir, exist_ok=True)
    
    minified_count = 0
    skipped_count = 0
    
    for css_file in os.listdir(css_dir):
        if css_file.endswith('.css') and not css_file.endswith('.min.css'):
            try:
                input_path = os.path.join(css_dir, css_file)
                output_path = os.path.join(min_dir, css_file.replace('.css', '.min.css'))
                
                # Skip already minified files if they're newer than source
                if os.path.exists(output_path) and \
                   os.path.getmtime(output_path) > os.path.getmtime(input_path):
                    logger.info(f"Skipping {css_file} (already up to date)")
                    skipped_count += 1
                    continue
                
                with open(input_path, 'r', encoding='utf-8') as f:
                    css_content = f.read()
                
                # Simple CSS minification using string replacements
                # Remove comments
                import re
                css_minified = re.sub(r'/\*[\s\S]*?\*/', '', css_content)
                # Remove whitespace
                css_minified = re.sub(r'\s+', ' ', css_minified)
                # Remove spaces around selectors
                css_minified = re.sub(r'\s*{\s*', '{', css_minified)
                css_minified = re.sub(r'\s*}\s*', '}', css_minified)
                css_minified = re.sub(r'\s*;\s*', ';', css_minified)
                css_minified = re.sub(r'\s*:\s*', ':', css_minified)
                css_minified = re.sub(r'\s*,\s*', ',', css_minified)
                # Remove last semicolons
                css_minified = re.sub(r';}', '}', css_minified)
                
                with open(output_path, 'w', encoding='utf-8') as f:
                    f.write(css_minified)
                
                size_original = len(css_content)
                size_minified = len(css_minified)
                reduction = (1 - size_minified / size_original) * 100 if size_original > 0 else 0
                
                logger.info(f"Minified {css_file} - Reduced by {reduction:.1f}%")
                minified_count += 1
            except Exception as e:
                logger.error(f"Error processing {css_file}: {e}")
    
    logger.info(f"CSS minification: {minified_count} files minified, {skipped_count} files skipped")
    return minified_count

def minify_html_templates():
    """Minify HTML template files."""
    templates_dir = 'templates'
    minified_count = 0
    skipped_count = 0
    
    for html_file in os.listdir(templates_dir):
        if html_file.endswith('.html'):
            try:
                input_path = os.path.join(templates_dir, html_file)
                
                with open(input_path, 'r', encoding='utf-8') as f:
                    html_content = f.read()
                
                # Minify HTML content while keeping important whitespace
                minified = htmlmin.minify(html_content, 
                                         remove_comments=True,
                                         remove_empty_space=True,
                                         remove_all_empty_space=False,
                                         reduce_boolean_attributes=True)
                
                # Write back to the same file
                with open(input_path, 'w', encoding='utf-8') as f:
                    f.write(minified)
                
                size_original = len(html_content)
                size_minified = len(minified)
                reduction = (1 - size_minified / size_original) * 100 if size_original > 0 else 0
                
                logger.info(f"Minified {html_file} - Reduced by {reduction:.1f}%")
                minified_count += 1
            except Exception as e:
                logger.error(f"Error processing {html_file}: {e}")
    
    logger.info(f"HTML minification: {minified_count} files minified, {skipped_count} files skipped")
    return minified_count

def create_size_report():
    """Create a report of file sizes before and after minification."""
    results = []
    
    # Check JS files
    js_dir = 'static/js'
    min_dir = os.path.join(js_dir, 'min')
    if os.path.exists(min_dir):
        for js_file in os.listdir(js_dir):
            if js_file.endswith('.js') and not js_file.endswith('.min.js'):
                orig_path = os.path.join(js_dir, js_file)
                min_path = os.path.join(min_dir, js_file.replace('.js', '.min.js'))
                
                if os.path.exists(min_path):
                    orig_size = os.path.getsize(orig_path)
                    min_size = os.path.getsize(min_path)
                    reduction = (1 - min_size / orig_size) * 100 if orig_size > 0 else 0
                    results.append({
                        'file': js_file,
                        'type': 'JavaScript',
                        'original_size': orig_size,
                        'minified_size': min_size,
                        'reduction': reduction
                    })
    
    # Check CSS files
    css_dir = 'static/css'
    min_dir = os.path.join(css_dir, 'min')
    if os.path.exists(min_dir):
        for css_file in os.listdir(css_dir):
            if css_file.endswith('.css') and not css_file.endswith('.min.css'):
                orig_path = os.path.join(css_dir, css_file)
                min_path = os.path.join(min_dir, css_file.replace('.css', '.min.css'))
                
                if os.path.exists(min_path):
                    orig_size = os.path.getsize(orig_path)
                    min_size = os.path.getsize(min_path)
                    reduction = (1 - min_size / orig_size) * 100 if orig_size > 0 else 0
                    results.append({
                        'file': css_file,
                        'type': 'CSS',
                        'original_size': orig_size,
                        'minified_size': min_size,
                        'reduction': reduction
                    })
    
    # Print the report
    total_orig = sum(item['original_size'] for item in results)
    total_min = sum(item['minified_size'] for item in results)
    total_reduction = (1 - total_min / total_orig) * 100 if total_orig > 0 else 0
    
    logger.info("\n" + "="*50)
    logger.info("MINIFICATION REPORT")
    logger.info("="*50)
    logger.info(f"{'File':<30} {'Type':<10} {'Original':<10} {'Minified':<10} {'Reduction'}")
    logger.info("-"*70)
    
    for item in results:
        logger.info(f"{item['file']:<30} {item['type']:<10} "
                   f"{item['original_size']/1024:.1f}KB {item['minified_size']/1024:.1f}KB "
                   f"{item['reduction']:.1f}%")
    
    logger.info("-"*70)
    logger.info(f"{'TOTAL:':<30} {'':<10} {total_orig/1024:.1f}KB {total_min/1024:.1f}KB {total_reduction:.1f}%")
    logger.info("="*50)

def main():
    """Main function to run minification tasks."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Minify web assets')
    parser.add_argument('--js', action='store_true', help='Minify JavaScript files')
    parser.add_argument('--css', action='store_true', help='Minify CSS files')
    parser.add_argument('--html', action='store_true', help='Minify HTML templates')
    parser.add_argument('--all', action='store_true', help='Minify all assets')
    parser.add_argument('--report', action='store_true', help='Generate size report only')
    
    args = parser.parse_args()
    
    # If no arguments, default to --all
    if not (args.js or args.css or args.html or args.report):
        args.all = True
    
    if args.all or args.js:
        minify_js_files()
    
    if args.all or args.css:
        minify_css_files()
    
    if args.all or args.html:
        minify_html_templates()
    
    # Always generate the report at the end if any minification was done
    if args.report or args.all or args.js or args.css:
        create_size_report()

if __name__ == "__main__":
    main()
