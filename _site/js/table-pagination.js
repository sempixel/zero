document.addEventListener('DOMContentLoaded', function() {
    const table = document.getElementById('data-table');
    const loadMoreBtn = document.getElementById('load-more');
    const visibleRows = 10; // Show 10 items initially
    const loadMoreCount = 10; // Load 10 more items each time
    let currentVisible = 0;
    let allRows = [];
    let isSorted = false;
    
    if (!table || !loadMoreBtn) return;
    
    // Initialize the table
    function initializeTable() {
        // Get all rows including hidden ones
        allRows = Array.from(table.querySelectorAll('.beer-row'));
        currentVisible = Math.min(visibleRows, allRows.length);
        updateVisibility();
    }
    
    // Update which rows are visible based on currentVisible
    function updateVisibility() {
        allRows.forEach((row, index) => {
            row.style.display = index < currentVisible ? '' : 'none';
        });
        
        // Update button text and visibility
        if (currentVisible >= allRows.length) {
            loadMoreBtn.style.display = 'none';
        } else {
            loadMoreBtn.style.display = 'block';
            const remaining = allRows.length - currentVisible;
            loadMoreBtn.textContent = `Voir plus (${remaining} restante${remaining > 1 ? 's' : ''})`;
        }
    }
    
    // Load more items
    loadMoreBtn.addEventListener('click', function() {
        currentVisible = Math.min(currentVisible + loadMoreCount, allRows.length);
        updateVisibility();
        
        // Scroll to show the newly loaded items
        if (currentVisible < allRows.length) {
            loadMoreBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
    
    // Handle sort changes - reset to first page when sort changes
    document.addEventListener('sortChanged', function() {
        currentVisible = Math.min(visibleRows, allRows.length);
        updateVisibility();
    });
    
    // Initialize the table
    initializeTable();
});
