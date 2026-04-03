import React from 'react';
import { Link } from 'react-router-dom';
import { getAllStats } from '../utils/searchableContent.js';
import './SearchableContentWidget.css';

const SearchableContentWidget = () => {
  const stats = getAllStats();

  return (
    <div className="searchable-content-widget">
      <div className="widget-content">
        <div className="widget-info">
          <h4>📚 Content Available</h4>
          <div className="widget-stats">
            🎙️ {stats.pravachan.grandTotal.toLocaleString()} Pravachans • 📜 {stats.granth.searchable} Granths
          </div>
        </div>

        <div className="widget-actions">
          <Link to="/search-index" className="btn-link">
            Browse All
          </Link>
        </div>
      </div>
    </div>
  );
};

export default SearchableContentWidget;
