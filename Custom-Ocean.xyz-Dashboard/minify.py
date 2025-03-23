import os
import htmlmin
import logging

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

TEMPLATES_DIR = "templates"
HTML_FILES = ["index.html", "error.html"]

def minify_html_file(file_path):
    """
    Minify an HTML file with error handling
    """
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
            
        # Check if file has content
        if not content.strip():
            logging.warning(f"File {file_path} is empty. Skipping.")
            return
            
        # Minify the content
        try:
            minified = htmlmin.minify(content, 
                                      remove_comments=True, 
                                      remove_empty_space=True,
                                      remove_all_empty_space=False,
                                      reduce_boolean_attributes=True)
                                      
            # Make sure minification worked and didn't remove everything
            if not minified.strip():
                logging.error(f"Minification of {file_path} resulted in empty content. Using original.")
                minified = content
                
            # Write back the minified content
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(minified)
                
            logging.info(f"Minified {file_path}")
            
        except Exception as e:
            logging.error(f"Error minifying {file_path}: {e}")
            
    except Exception as e:
        logging.error(f"Error reading file {file_path}: {e}")

def ensure_templates_dir():
    """
    Ensure templates directory exists
    """
    if not os.path.exists(TEMPLATES_DIR):
        try:
            os.makedirs(TEMPLATES_DIR)
            logging.info(f"Created templates directory: {TEMPLATES_DIR}")
        except Exception as e:
            logging.error(f"Error creating templates directory: {e}")
            return False
    return True

if __name__ == "__main__":
    logging.info("Starting HTML minification process")
    
    if not ensure_templates_dir():
        logging.error("Templates directory does not exist and could not be created. Exiting.")
        exit(1)
        
    for filename in HTML_FILES:
        file_path = os.path.join(TEMPLATES_DIR, filename)
        if os.path.exists(file_path):
            minify_html_file(file_path)
        else:
            logging.warning(f"File {file_path} not found.")
            
    logging.info("HTML minification process completed")